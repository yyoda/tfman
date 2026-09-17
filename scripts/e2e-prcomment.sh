#!/usr/bin/env bash
set -euo pipefail

usage() {
    printf '%s\n' 'Usage: e2e-prcomment.sh [options]' \
        'Maintainer-run PRReview/PRComment test on the current repository.' \
        '  --base <branch>     Base branch (default: main)' \
        '  --keep              Keep the temporary draft PR and remote branch' \
        '  --toggle-appliers   Temporarily set APPLIERS to [] and test denial' \
        '  --skip-apply        Skip authorized apply' \
        '  --timeout <seconds> Timeout per wait (default: 900)' \
        '  -h, --help          Show usage without accessing Git or the network'
}
die() { printf '==> %s\n' "$*" >&2; exit 1; }
progress() { printf '==> %s\n' "$*" >&2; }
base=main keep=false toggle=false skip_apply=false timeout=900
while (($#)); do
    case "$1" in
        -h|--help) usage; exit 0 ;;
        --keep) keep=true; shift ;;
        --toggle-appliers) toggle=true; shift ;;
        --skip-apply) skip_apply=true; shift ;;
        --base|--timeout)
            (($# >= 2)) && [[ -n $2 ]] || die "Missing value for $1"
            if [[ $1 == --base ]]; then base=$2; else timeout=$2; fi
            shift 2 ;;
        *) die "Unknown option: $1" ;;
    esac
done
[[ $timeout =~ ^[1-9][0-9]*$ ]] && ((${#timeout} < 9)) || die 'Timeout must be a positive integer below 100000000'
for command in gh jq git sed date sleep; do
    command -v "$command" >/dev/null || die "Required command missing: $command"
done
gh api user --jq .login >/dev/null 2>&1 || die 'Authenticate with gh before running this script'
root=$(git rev-parse --show-toplevel) || die 'Run inside the repository'
cd "$root"
[[ -z $(git status --porcelain --untracked-files=no) ]] || die 'Tracked working tree changes must be committed or stashed first'
git remote get-url origin >/dev/null || die 'The origin remote is required'
original=$(git symbolic-ref --short HEAD) || die 'Check out a branch before running this script'
repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)
branch="e2e/prcomment-$(date -u +%Y%m%dT%H%M%SZ)"
pr='' created=false restore=false saved_appliers='' failed=0 note=''
results=()
restore_appliers() {
    if "$restore"; then
        gh variable set APPLIERS --repo "$repo" --body "$saved_appliers" || return 1
        restore=false
    fi
}
cleanup() {
    local code=$?
    trap - EXIT INT TERM
    restore_appliers || { progress 'FAILED to restore APPLIERS; restore it manually'; code=1; }
    if [[ -n $pr ]] && ! "$keep"; then
        gh pr close "$pr" --repo "$repo" --delete-branch || code=1
    fi
    if "$created"; then
        # Only these tracked fixtures can have uncommitted changes from this script.
        git restore -- environments/test1/main.tf environments/test2/main.tf || code=1
        if git checkout "$original"; then
            # gh pr close may already have deleted the local branch.
            if git show-ref --verify --quiet "refs/heads/$branch"; then
                git branch -D "$branch" || code=1
            fi
        else code=1
        fi
    fi
    exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

pause() { sleep "$1"; }
newest_run() {
    local workflow=$1
    local args=(--repo "$repo" --workflow "$workflow" --limit 1 --json databaseId)
    [[ $workflow == pr-comment.yml ]] || args+=(--branch "$branch")
    gh run list "${args[@]}" | jq -r '.[0].databaseId // 0'
}
wait_for_new_run() {
    local workflow=$1 previous=$2 id end=$((SECONDS + timeout))
    while ((SECONDS < end)); do
        id=$(newest_run "$workflow") || return 1
        if [[ $workflow == pr-comment.yml ]]; then
            if ((id > previous)); then printf '%s\n' "$id"; return; fi
        elif [[ $id != 0 && $id != "$previous" ]]; then printf '%s\n' "$id"; return
        fi
        pause 5
    done
    progress "Timed out waiting for a new $workflow run"; return 1
}
wait_for_completion() {
    local data end=$((SECONDS + timeout))
    while ((SECONDS < end)); do
        data=$(gh run view "$1" --repo "$repo" --json status,conclusion,jobs) || return 1
        if [[ $(jq -r .status <<< "$data") == completed ]]; then printf '%s\n' "$data"; return; fi
        pause 10
    done
    progress "Timed out waiting for run $1"; return 1
}
wait_for_run_job_started() {
    local data end=$((SECONDS + timeout))
    while ((SECONDS < end)); do
        data=$(gh run view "$1" --repo "$repo" --json status,jobs) || return 1
        if jq -e '.jobs | any(.name | startswith("run on"))' <<< "$data" >/dev/null &&
            jq -e '.jobs | any((.name | startswith("run on")) and (.status == "queued" or .status == "in_progress"))' <<< "$data" >/dev/null; then return; fi
        [[ $(jq -r .status <<< "$data") != completed ]] || return 1
        pause 2
    done
    progress "Timed out waiting for a run job in $1"; return 1
}
comments() {
    gh api --paginate "repos/$repo/issues/$pr/comments" | jq -s 'add | map(select(.user.type == "Bot")) | sort_by(.id)'
}
latest_comment() { comments | jq -r --arg prefix "$1" 'map(select(.body | startswith($prefix))) | last | .body // ""'; }
assert_json() { jq -e "$2" <<< "$1" >/dev/null || { note=$3; return 1; }; }
contains() { [[ $1 == *"$2"* ]] || { note="Missing expected text: $2"; return 1; }; }
status_is() {
    local statuses
    statuses=$(gh api --paginate "repos/$repo/commits/$sha/statuses" | jq -s --arg context "$1" 'add | map(select(.context == $context)) | sort_by(.id) | last') || return 1
    assert_json "$statuses" ".state == \"$2\"" "Unexpected $1 status" || return 1
    if [[ ${3:-} != '' ]]; then
        contains "$(jq -r .description <<< "$statuses")" "$3" || return 1
    fi
}
post_command() {
    previous=$(newest_run pr-comment.yml) || return 1
    gh pr comment "$pr" --repo "$repo" --body "$1" >/dev/null || return 1
    run=$(wait_for_new_run pr-comment.yml "$previous") || return 1
}
test1='`environments/test1` | ⚠️ | +1 add, -1 destroy'
review_plan() {
    run=$(wait_for_new_run pr-review.yml 0) || return 1
    data=$(wait_for_completion "$run") || return 1
    assert_json "$data" '.conclusion == "success"' 'PRReview did not succeed' || return 1
    body=$(latest_comment '## 📋') || return 1
    contains "$body" "$test1"
}
ignored_comment() {
    previous=$(newest_run pr-comment.yml) || return 1
    gh pr comment "$pr" --repo "$repo" --body 'terraform plan' >/dev/null || return 1
    pause 20
    run=$(newest_run pr-comment.yml) || return 1
    [[ $run != "$previous" ]] || return 0
    data=$(gh run view "$run" --repo "$repo" --json jobs) || return 1
    assert_json "$data" '.jobs | all(.conclusion == "skipped")' 'Ignored comment started non-skipped jobs'
}
plan() {
    post_command '$terraform plan' || return 1
    data=$(wait_for_completion "$run") || return 1
    assert_json "$data" '.conclusion == "success"' 'Plan did not succeed' || return 1
    status_is terraform/plan success || return 1
    data=$(comments) || return 1
    assert_json "$data" '[.[] | select(.body | startswith("## 📋"))] | length == 1' 'Expected exactly one plan comment' || return 1
    body=$(latest_comment '## 📋') || return 1
    contains "$body" "$test1"
}
cancel_early() {
    post_command '$terraform plan' || return 1
    wait_for_run_job_started "$run" || return 1
    gh run cancel "$run" --repo "$repo" || return 1
    data=$(wait_for_completion "$run") || return 1
    status_is terraform/plan error cancelled || return 1
    body=$(latest_comment '## 📋') || return 1
    contains "$body" '`environments/test1` | ❌ | Plan Failed' || return 1
    contains "$body" 'No result artifact was produced'
}
unauthorized_apply() {
    saved_appliers=$(gh variable get APPLIERS --repo "$repo") || return 1
    restore=true
    gh variable set APPLIERS --repo "$repo" --body '[]' || return 1
    post_command '$terraform apply' || return 1
    data=$(wait_for_completion "$run") || return 1
    restore_appliers || return 1
    assert_json "$data" '[.jobs[] | select((.name | startswith("run on")) or .name == "post-run")] | length >= 2 and all(.conclusion == "skipped")' 'Apply jobs were not skipped' || return 1
    body=$(latest_comment '') || return 1
    contains "$body" 'does not have permission to apply'
}
authorized_apply() {
    restore_appliers || return 1
    post_command '$terraform apply' || return 1
    data=$(wait_for_completion "$run") || return 1
    assert_json "$data" '.conclusion == "success"' 'Apply did not succeed' || return 1
    status_is terraform/apply success || return 1
    body=$(latest_comment '## 🚀') || return 1
    contains "$body" '`environments/test1` | ✅ | +1, -1'
}
broken_fixture() {
    previous=$(newest_run pr-review.yml) || return 1
    printf '\n\nresource "null_resource"   "broken" {\n    triggers   = { name="broken" }\n}\n' >> environments/test2/main.tf
    git add -- environments/test2/main.tf || return 1
    git commit -m 'test: broken formatting fixture (do not merge)' || return 1
    git push origin "$branch" || return 1
    run=$(wait_for_new_run pr-review.yml "$previous") || return 1
    data=$(wait_for_completion "$run") || return 1
    assert_json "$data" '.conclusion == "failure" and any(.jobs[]; .name == "plan on environments/test2" and .conclusion == "failure")' 'Expected test2 plan failure' || return 1
    body=$(latest_comment '## 📋') || return 1
    contains "$body" "$test1" || return 1
    contains "$body" '`environments/test2` | ❌ | Plan Failed'
}
scenario() {
    local label=$1 function=$2 result=PASS
    progress "$label"; note='All assertions passed'
    if "$function"; then :; else
        result=FAIL; failed=1
        [[ $note != 'All assertions passed' ]] || note='Command failed or wait timed out'
    fi
    if ! restore_appliers; then result=FAIL; failed=1; note='Failed to restore APPLIERS'; fi
    note=${note//$'\n'/ }; note=${note//|/\\|}
    results+=("| $label | $result | $note |")
}
progress 'Creating temporary branch and draft PR'
git fetch origin "$base"
git checkout -b "$branch" "origin/$base"
created=true
fixture=$(<environments/test1/main.tf)
[[ $fixture == *'name = "test1"'* ]] || die 'Missing test1 name fixture'
printf '%s\n' "$fixture" | sed 's/name = "test1"/name = "test1-e2e"/' > environments/test1/main.tf
git add -- environments/test1/main.tf
git commit -m 'test: PRComment e2e (do not merge)'
git push -u origin "$branch"
gh pr create --repo "$repo" --base "$base" --head "$branch" --draft \
    --title 'test: PRComment e2e (do not merge)' \
    --body 'Temporary maintainer-run PRReview/PRComment end-to-end test. Do not merge. This PR exercises plan, cancellation, apply, and malformed fixture handling.'
pr=$(gh pr view "$branch" --repo "$repo" --json number -q .number)
sha=$(gh pr view "$pr" --repo "$repo" --json headRefOid -q .headRefOid)
scenario 'PRReview plan' review_plan
scenario 'Ignored comment' ignored_comment
scenario '$terraform plan' plan
scenario 'Cancel early' cancel_early
if "$toggle"; then scenario 'Unauthorized apply' unauthorized_apply; fi
if ! "$skip_apply"; then scenario 'Authorized apply' authorized_apply; fi
scenario 'Broken fixture' broken_fixture
table=$(printf '%s\n' '| Scenario | Result | Note |' '| --- | --- | --- |' "${results[@]}")
gh pr comment "$pr" --repo "$repo" --body "$table" || failed=1
printf '%s\n' "$table"
exit "$failed"
