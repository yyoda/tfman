#!/usr/bin/env bash
# Functional tests for scripts/install.sh.
# Each test clones yyoda/tfman fresh (resets the skill's tmp/), runs install.sh
# against an isolated mktemp target, and asserts on the observed result.
# Network is required.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTALL="$SKILL_DIR/scripts/install.sh"
TMP_CLONE="$SKILL_DIR/tmp/tfman"

pass=0; fail=0

reset_skill_state() {
  rm -rf "$TMP_CLONE"
}

run_test() {
  local name=$1; local fn=$2
  if "$fn"; then
    echo "PASS: $name"
    pass=$((pass+1))
  else
    echo "FAIL: $name (rc=$?)"
    fail=$((fail+1))
  fi
}

# 1. Initial install — no tmp/tfman, empty target.
test_initial_install() {
  reset_skill_state
  local target; target=$(mktemp -d)
  ( cd "$target" && "$INSTALL" ) >/dev/null 2>&1 || { rm -rf "$target"; return 1; }
  [ -d "$target/.github/scripts" ] || { rm -rf "$target"; return 1; }
  [ -d "$target/.github/workflows" ] || { rm -rf "$target"; return 1; }
  rm -rf "$target"
}

# 2. Idempotent re-run — fetch+reset path produces same tree.
test_idempotent_rerun() {
  reset_skill_state
  local target; target=$(mktemp -d)
  ( cd "$target" && "$INSTALL" ) >/dev/null 2>&1 || { rm -rf "$target"; return 1; }
  local snap1; snap1=$(cd "$target" && find .github -type f -exec shasum -a 256 {} + | sort)
  ( cd "$target" && "$INSTALL" ) >/dev/null 2>&1 || { rm -rf "$target"; return 1; }
  local snap2; snap2=$(cd "$target" && find .github -type f -exec shasum -a 256 {} + | sort)
  [ "$snap1" = "$snap2" ] || { rm -rf "$target"; return 1; }
  rm -rf "$target"
}

# 3. Corrupt tmp/tfman without .git → exit 3.
test_exit3_corrupt_clone() {
  reset_skill_state
  mkdir -p "$TMP_CLONE"
  echo junk > "$TMP_CLONE/junk.txt"
  local target; target=$(mktemp -d)
  ( cd "$target" && "$INSTALL" ) >/dev/null 2>&1
  local rc=$?
  rm -rf "$target"
  [ "$rc" = "3" ]
}

# 4. Custom workflow with non-tfman filename survives.
test_preserves_custom_workflow() {
  reset_skill_state
  local target; target=$(mktemp -d)
  mkdir -p "$target/.github/workflows"
  echo "name: my-ci" > "$target/.github/workflows/my-custom-ci.yml"
  ( cd "$target" && "$INSTALL" ) >/dev/null 2>&1 || { rm -rf "$target"; return 1; }
  [ -f "$target/.github/workflows/my-custom-ci.yml" ] || { rm -rf "$target"; return 1; }
  rm -rf "$target"
}

# 5. .github/env.d/ in the target is untouched (out of scope for this script).
test_envd_untouched() {
  reset_skill_state
  local target; target=$(mktemp -d)
  mkdir -p "$target/.github/env.d/environments/test1"
  echo "FOO=bar" > "$target/.github/env.d/environments/test1/.env"
  ( cd "$target" && "$INSTALL" ) >/dev/null 2>&1 || { rm -rf "$target"; return 1; }
  [ -f "$target/.github/env.d/environments/test1/.env" ] || { rm -rf "$target"; return 1; }
  grep -q "FOO=bar" "$target/.github/env.d/environments/test1/.env" || { rm -rf "$target"; return 1; }
  rm -rf "$target"
}

# 6. TFMAN_REPO_URL override is honored — invalid URL must fail clone.
test_repo_url_override() {
  reset_skill_state
  local target; target=$(mktemp -d)
  ( cd "$target" && TFMAN_REPO_URL="https://invalid.invalid/no-such-repo.git" "$INSTALL" ) >/dev/null 2>&1
  local rc=$?
  rm -rf "$target"
  [ "$rc" -ne 0 ]
}

# 7. trap ERR surfaces a diagnostic line on failure.
test_trap_err_reports() {
  reset_skill_state
  local target; target=$(mktemp -d)
  mkdir -p "$target/.github"
  chmod 555 "$target/.github"
  local out; out=$(cd "$target" && "$INSTALL" 2>&1)
  local rc=$?
  chmod 755 "$target/.github"
  rm -rf "$target"
  [ "$rc" -ne 0 ] || return 1
  echo "$out" | grep -q "install-tfman: failed at line"
}

run_test "initial install"                  test_initial_install
run_test "idempotent rerun (fetch+reset)"   test_idempotent_rerun
run_test "exit 3 on corrupt tmp"            test_exit3_corrupt_clone
run_test "preserves custom workflow"        test_preserves_custom_workflow
run_test "env.d untouched"                  test_envd_untouched
run_test "TFMAN_REPO_URL override"          test_repo_url_override
run_test "trap ERR reports failure"         test_trap_err_reports

reset_skill_state

echo
echo "Summary: PASS=$pass  FAIL=$fail"
[ "$fail" -eq 0 ]
