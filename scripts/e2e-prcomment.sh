#!/usr/bin/env bash
set -euo pipefail

usage() {
    printf '%s\n' 'Usage: e2e-prcomment.sh [options]' \
        'Maintainer-run PRReview/PRComment test on the current repository.' \
        '  --base <branch>     Base branch (default: main)' \
        '  --keep              Keep the temporary draft PR and remote branch' \
        '  --toggle-appliers   Temporarily set APPLIERS to [] and test denial' \
        '  --cleanup-only      Test cleanup-only changes as the last scenario' \
        '  --skip-apply        Skip authorized apply' \
        '  --timeout <seconds> Timeout per wait (default: 900)' \
        '  -h, --help          Show usage without accessing Git or the network' \
        'Checks plan provenance stamps, post-job reruns, and stale reruns.' \
        'Run against main after the feature is merged, in one sitting: artifacts are retained 1 day.'
}
die() { printf '==> %s\n' "$*" >&2; exit 1; }
progress() { printf '==> %s\n' "$*" >&2; }
base=main keep=false toggle=false skip_apply=false cleanup_only=false timeout=900
while (($#)); do
    case "$1" in
        -h|--help) usage; exit 0 ;;
        --cleanup-only) cleanup_only=true; shift ;;
        --keep) keep=true; shift ;;
        --toggle-appliers) toggle=true; shift ;;
        --skip-apply) skip_apply=true; shift ;;
        --base) base=${2:?"--base needs a value"}; shift 2 ;;
        --timeout) timeout=${2:?"--timeout needs a value"}; shift 2 ;;
        *) die "Unknown option: $1" ;;
    esac
done
[[ $timeout =~ ^[1-9][0-9]*$ ]] || die 'Timeout must be a positive integer'
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
first_head='' first_review_run='' broken_review_run='' broken_snapshot='' rerun_snapshot='' marker_created=false
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
        if "$marker_created"; then
            git reset -- e2e-cleanup-marker.txt || code=1
            git clean -f -- e2e-cleanup-marker.txt || code=1
        fi
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

newest_run() {
    local workflow=$1
    shift
    local args=(--repo "$repo" --workflow "$workflow" --limit 1 --json databaseId)
    gh run list "${args[@]}" "$@" | jq -r '.[0].databaseId // 0'
}
wait_for_new_run() {
    local workflow=$1 previous=$2 id end=$((SECONDS + timeout))
    shift 2
    while ((SECONDS < end)); do
        id=$(newest_run "$workflow" "$@") || return 1
        if ((id > previous)); then printf '%s\n' "$id"; return; fi
        sleep 5
    done
    progress "Timed out waiting for a new $workflow run"; return 1
}
wait_for_completion() {
    local data end=$((SECONDS + timeout))
    while ((SECONDS < end)); do
        data=$(gh run view "$1" --repo "$repo" --json status,conclusion,jobs) || return 1
        if [[ $(jq -r .status <<< "$data") == completed ]]; then printf '%s\n' "$data"; return; fi
        sleep 10
    done
    progress "Timed out waiting for run $1"; return 1
}
wait_for_attempt_completion() {
    local run_id=$1 attempt=$2 data end=$((SECONDS + timeout))
    while ((SECONDS < end)); do
        data=$(gh run view "$run_id" --repo "$repo" --json attempt,status) || return 1
        if jq -e --argjson attempt "$attempt" '.attempt == $attempt and .status == "completed"' <<< "$data" >/dev/null; then return 0; fi
        sleep 5
    done
    note="Timed out waiting for run $run_id attempt $attempt"; return 1
}
wait_for_run_job_started() {
    local data end=$((SECONDS + timeout))
    while ((SECONDS < end)); do
        data=$(gh run view "$1" --repo "$repo" --json status,jobs) || return 1
        case $(jq -r '
            if .jobs | any((.name | startswith("run on")) and (.status == "queued" or .status == "in_progress")) then "started"
            elif .status == "completed" then "completed"
            else "waiting" end' <<< "$data") in
            started) return ;;
            completed) return 1 ;;
            waiting) sleep 2 ;;
        esac
    done
    progress "Timed out waiting for a run job in $1"; return 1
}
comments() {
    gh api --paginate "repos/$repo/issues/$pr/comments" | jq -s 'add | map(select(.user.type == "Bot")) | sort_by(.id)'
}
plan_comments() {
    comments | jq 'map(select(.body | startswith("## 📋")) | {id, body})'
}
apply_comments() {
    comments | jq 'map(select(.body | startswith("## 🚀")) | {id, body})'
}
# Wait until the PR reports the commit that is checked out locally; PR metadata can lag a push.
refresh_head() {
    local expected end=$((SECONDS + timeout))
    expected=$(git rev-parse HEAD) || return 1
    while ((SECONDS < end)); do
        sha=$(gh pr view "$pr" --repo "$repo" --json headRefOid -q .headRefOid) || return 1
        [[ $sha == "$expected" ]] && return 0
        sleep 2
    done
    note="PR head did not become $expected"; return 1
}
stamp_line() { sed -n '2p' <<< "$1"; }
assert_stamp_pure() {
    local body=$1 expected_head=$2 merge=$3 run_url=$4 attempt=$5 line merge_commit
    [[ ${body%%$'\n'*} == '## 📋 Terraform Plan Summary' ]] || { note='Incorrect plan summary heading'; return 1; }
    line=$(stamp_line "$body") || return 1
    if [[ $merge == any40 ]]; then
        local pattern='^> tfman-plan-provenance: pr_head=([0-9a-f]{40}) merge_commit=([0-9a-f]{40}) run='
        [[ $line =~ $pattern ]] || { note='Missing or malformed provenance stamp'; return 1; }
        merge_commit=${BASH_REMATCH[2]}
        [[ $merge_commit != "$expected_head" ]] || { note='Merge commit equals PR head'; return 1; }
    elif [[ $merge == none ]]; then
        merge_commit=none
    else
        note="Unknown merge expectation: $merge"; return 1
    fi
    [[ $line == "> tfman-plan-provenance: pr_head=$expected_head merge_commit=$merge_commit run=$run_url/attempts/$attempt" ]] || {
        note='Provenance stamp does not match expected head, merge, run URL, or attempt'; return 1;
    }
}
assert_stamp() {
    local run_url
    run_url=$(gh run view "$4" --repo "$repo" --json url -q .url) || return 1
    assert_stamp_pure "$1" "$2" "$3" "$run_url" "$5"
}
latest_comment_from() { jq -r --arg prefix "$2" 'map(select(.body | startswith($prefix))) | last | .body // ""' <<< "$1"; }
latest_comment() {
    local data
    data=$(comments) || return 1
    latest_comment_from "$data" "$1"
}
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
    run=$(wait_for_new_run pr-review.yml 0 --branch "$branch") || return 1
    first_review_run=$run
    data=$(wait_for_completion "$run") || return 1
    assert_json "$data" '.conclusion == "success"' 'PRReview did not succeed' || return 1
    body=$(latest_comment '## 📋') || return 1
    contains "$body" "$test1" || return 1
    data=$(plan_comments) || return 1
    assert_json "$data" 'length == 1' 'Expected exactly one plan comment' || return 1
    assert_stamp "$body" "$sha" any40 "$run" 1
}
ignored_comment() {
    previous=$(newest_run pr-comment.yml) || return 1
    gh pr comment "$pr" --repo "$repo" --body 'terraform plan' >/dev/null || return 1
    sleep 20
    run=$(newest_run pr-comment.yml) || return 1
    [[ $run != "$previous" ]] || return 0
    data=$(gh run view "$run" --repo "$repo" --json jobs) || return 1
    assert_json "$data" '.jobs | all(.conclusion == "skipped")' 'Ignored comment started non-skipped jobs'
}
plan() {
    local old_ids
    old_ids=$(plan_comments | jq 'map(.id)') || return 1
    post_command '$terraform plan' || return 1
    data=$(wait_for_completion "$run") || return 1
    assert_json "$data" '.conclusion == "success"' 'Plan did not succeed' || return 1
    status_is terraform/plan success || return 1
    data=$(comments) || return 1
    assert_json "$data" '[.[] | select(.body | startswith("## 📋"))] | length == 1' 'Expected exactly one plan comment' || return 1
    body=$(latest_comment_from "$data" '## 📋') || return 1
    contains "$body" "$test1" || return 1
    data=$(plan_comments) || return 1
    jq -e --argjson old "$old_ids" '.[0].id as $id | $old | index($id) == null' <<< "$data" >/dev/null || { note='Plan comment id was not replaced'; return 1; }
    assert_stamp "$body" "$sha" none "$run" 1
}
cancel_early() {
    local attempt max=3
    for ((attempt = 1; attempt <= max; attempt++)); do
        post_command '$terraform plan' || return 1
        wait_for_run_job_started "$run" || return 1
        gh run cancel "$run" --repo "$repo" || return 1
        data=$(wait_for_completion "$run") || return 1
        # The cancel can land after Terraform Plan already finished; that run produces an artifact and cannot show an early cancellation, so try again.
        if jq -e '[.jobs[] | select(.name | startswith("run on")) | .steps[]? | select(.name == "Terraform Plan" and .conclusion == "success")] | length == 0' <<< "$data" >/dev/null; then
            break
        fi
        progress "Cancel early: the cancel landed after Terraform Plan finished (attempt $attempt/$max)"
    done
    # Return 77 (inconclusive; the conventional "skip" code, which jq/gh/grep never use for their own failures): the scenario could not create an early cancellation, which says nothing about the code under test.
    ((attempt <= max)) || { note="Inconclusive: the cancel landed after Terraform Plan finished in all $max attempts"; return 77; }
    status_is terraform/plan error cancelled || return 1
    body=$(latest_comment '## 📋') || return 1
    contains "$body" '`environments/test1` | ❌ | Plan Failed' || return 1
    contains "$body" 'No result artifact was produced' || return 1
    data=$(plan_comments) || return 1
    assert_json "$data" 'length == 1' 'Expected exactly one plan comment' || return 1
    assert_stamp "$body" "$sha" none "$run" 1
}
unauthorized_apply() {
    local before after
    before=$(plan_comments) || return 1
    saved_appliers=$(gh variable get APPLIERS --repo "$repo") || return 1
    restore=true
    gh variable set APPLIERS --repo "$repo" --body '[]' || return 1
    post_command '$terraform apply' || return 1
    data=$(wait_for_completion "$run") || return 1
    assert_json "$data" '[.jobs[] | select((.name | startswith("run on")) or .name == "post-run")] | length >= 2 and all(.conclusion == "skipped")' 'Apply jobs were not skipped' || return 1
    body=$(latest_comment '') || return 1
    contains "$body" 'does not have permission to apply' || return 1
    after=$(plan_comments) || return 1
    [[ $after == "$before" ]] || { note='Apply changed plan comments'; return 1; }
}
authorized_apply() {
    local before after
    before=$(plan_comments) || return 1
    post_command '$terraform apply' || return 1
    data=$(wait_for_completion "$run") || return 1
    assert_json "$data" '.conclusion == "success"' 'Apply did not succeed' || return 1
    status_is terraform/apply success || return 1
    body=$(latest_comment '## 🚀') || return 1
    contains "$body" '`environments/test1` | ✅ | +1, -1' || return 1
    [[ $body != *tfman-plan-provenance* ]] || { note='Apply comment contains plan provenance'; return 1; }
    after=$(plan_comments) || return 1
    [[ $after == "$before" ]] || { note='Apply changed plan comments'; return 1; }
}
broken_fixture() {
    previous=$(newest_run pr-review.yml --branch "$branch") || return 1
    printf '\n\nresource "null_resource"   "broken" {\n    triggers   = { name="broken" }\n}\n' >> environments/test2/main.tf
    git add -- environments/test2/main.tf || return 1
    git commit -m 'test: broken formatting fixture (do not merge)' || return 1
    git push origin "$branch" || return 1
    refresh_head || return 1
    [[ $sha != "$first_head" ]] || { note='Broken fixture did not change PR head'; return 1; }
    run=$(wait_for_new_run pr-review.yml "$previous" --branch "$branch") || return 1
    broken_review_run=$run
    data=$(wait_for_completion "$run") || return 1
    assert_json "$data" '.conclusion == "failure" and any(.jobs[]; .name == "plan on environments/test2" and .conclusion == "failure")' 'Expected test2 plan failure' || return 1
    body=$(latest_comment '## 📋') || return 1
    contains "$body" "$test1" || return 1
    contains "$body" '`environments/test2` | ❌ | Plan Failed' || return 1
    assert_json "$data" '[.jobs[] | select(.name == "post-plan")] | length == 1 and all(.conclusion == "success")' 'post-plan did not succeed' || return 1
    local snapshot
    snapshot=$(plan_comments) || return 1
    assert_json "$snapshot" 'length == 1' 'Expected exactly one plan comment' || return 1
    assert_stamp "$body" "$sha" any40 "$run" 1 || return 1
    broken_snapshot=$snapshot
}
rerun_post_job() {
    local run_id=$1 jobs job_id
    jobs=$(gh run view "$run_id" --repo "$repo" --json jobs) || return 1
    assert_json "$jobs" '[.jobs[] | select(.name == "post-plan")] | length == 1' 'Expected exactly one post-plan job' || return 1
    job_id=$(jq -r '.jobs[] | select(.name=="post-plan") | .databaseId' <<< "$jobs") || return 1
    gh run rerun "$run_id" --repo "$repo" --job "$job_id" || return 1
    wait_for_attempt_completion "$run_id" 2 || return 1
    jobs=$(gh run view "$run_id" --repo "$repo" --attempt 2 --json jobs) || return 1
    assert_json "$jobs" '[.jobs[] | select(.name == "post-plan")] | length == 1 and all(.conclusion == "success")' 'Rerun post-plan did not succeed'
}
post_job_rerun() {
    [[ -n $broken_review_run && -n $broken_snapshot ]] || { note='Missing broken review run or snapshot'; return 1; }
    rerun_post_job "$broken_review_run" || return 1
    local snapshot body old_body old_id expected_body attempt_one='/attempts/1' attempt_two='/attempts/2' end=$((SECONDS + timeout))
    old_body=$(jq -r '.[0].body' <<< "$broken_snapshot") || return 1
    old_id=$(jq -r '.[0].id' <<< "$broken_snapshot") || return 1
    while ((SECONDS < end)); do
        snapshot=$(plan_comments) || return 1
        if jq -e 'length == 1' <<< "$snapshot" >/dev/null; then
            body=$(jq -r '.[0].body' <<< "$snapshot") || return 1
            if [[ $(stamp_line "$body") == *'/attempts/2'* ]]; then
                [[ $(jq -r '.[0].id' <<< "$snapshot") != "$old_id" ]] || { note='Rerun did not replace comment id'; return 1; }
                # Keep pattern and replacement in variables: bash 3.2 (macOS) leaves backslashes in an escaped replacement.
                expected_body=${old_body//"$attempt_one"/$attempt_two}
                [[ $body == "$expected_body" ]] || { note='Rerun changed more than the attempt'; return 1; }
                rerun_snapshot=$snapshot
                return 0
            fi
        fi
        sleep 5
    done
    note='Timed out waiting for attempt 2 plan comment'; return 1
}
stale_post_job_rerun() {
    [[ -n $first_review_run && -n $rerun_snapshot ]] || { note='Missing first review run or rerun snapshot'; return 1; }
    rerun_post_job "$first_review_run" || return 1
    refresh_head || return 1
    [[ $sha != "$first_head" ]] || { note='PR head is not stale relative to the first run'; return 1; }
    sleep 5
    local snapshot
    snapshot=$(plan_comments) || return 1
    [[ $snapshot == "$rerun_snapshot" ]] || { note='Stale rerun changed plan comments'; return 1; }
}
cleanup_only_changes() {
    local before after snapshot end
    before=$(apply_comments) || return 1
    previous=$(newest_run pr-review.yml --branch "$branch") || return 1
    git restore --source="origin/$base" -- environments/test1/main.tf environments/test2/main.tf || return 1
    [[ ! -e e2e-cleanup-marker.txt && ! -L e2e-cleanup-marker.txt ]] || { note='Cleanup marker already exists'; return 1; }
    marker_created=true
    printf '%s\n' "$branch cleanup $(date -u +%Y%m%dT%H%M%SZ)" > e2e-cleanup-marker.txt || return 1
    git add -- environments/test1/main.tf environments/test2/main.tf e2e-cleanup-marker.txt || return 1
    git commit -m 'test: cleanup-only fixture (do not merge)' || return 1
    git push origin "$branch" || return 1
    refresh_head || return 1
    run=$(wait_for_new_run pr-review.yml "$previous" --branch "$branch") || return 1
    data=$(wait_for_completion "$run") || return 1
    assert_json "$data" '.conclusion == "success" and ([.jobs[] | select(.name == "detect-changes" or .name == "post-plan")] | length == 2 and all(.conclusion == "success")) and all(.jobs[]; (.name | startswith("plan on ") | not) or .conclusion == "skipped")' 'Cleanup-only run or jobs had unexpected conclusions' || return 1
    end=$((SECONDS + timeout))
    while ((SECONDS < end)); do
        snapshot=$(plan_comments) || return 1
        if jq -e 'length == 0' <<< "$snapshot" >/dev/null; then
            after=$(apply_comments) || return 1
            [[ $after == "$before" ]] || { note='Cleanup-only changed apply comments'; return 1; }
            return 0
        fi
        sleep 5
    done
    note='Timed out waiting for zero plan comments'; return 1
}
scenario() {
    local label=$1 function=$2 result=PASS code=0
    note=''
    progress "$label"
    "$function" || code=$?
    if ((code == 77)); then
        # INCONCLUSIVE does not fail the suite; the note says why nothing was verified.
        result=INCONCLUSIVE
        note=${note:-'Could not exercise the scenario'}
    elif ((code != 0)); then
        result=FAIL; failed=1
        note=${note:-'Command failed or wait timed out'}
    else
        note='All assertions passed'
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
pr_data=$(gh pr view "$branch" --repo "$repo" --json number,headRefOid)
pr=$(jq -r .number <<< "$pr_data")
refresh_head || die 'Could not read the PR head'
first_head=$sha
scenario 'PRReview plan' review_plan
scenario 'Ignored comment' ignored_comment
scenario '$terraform plan' plan
scenario 'Cancel early' cancel_early
if "$toggle"; then scenario 'Unauthorized apply' unauthorized_apply; fi
if ! "$skip_apply"; then scenario 'Authorized apply' authorized_apply; fi
scenario 'Broken fixture' broken_fixture
scenario 'Post-job rerun' post_job_rerun
scenario 'Stale post-job rerun' stale_post_job_rerun
if "$cleanup_only"; then scenario 'Cleanup-only' cleanup_only_changes; fi
table=$(printf '%s\n' '| Scenario | Result | Note |' '| --- | --- | --- |' "${results[@]}")
gh pr comment "$pr" --repo "$repo" --body "$table" || failed=1
printf '%s\n' "$table"
exit "$failed"
