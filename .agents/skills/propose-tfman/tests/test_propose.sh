#!/usr/bin/env bash
# Functional tests for scripts/propose.sh.
# Tests 1-4 are local-only (no gh auth or network required).
# Test 5 is an integration test against yyoda/tfman in dry-run mode; it is
# skipped automatically when `gh auth status` fails or there is no network.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROPOSE="$SKILL_DIR/scripts/propose.sh"
TMP_DIR="$SKILL_DIR/tmp"
TMP_WORK="$TMP_DIR/work"

pass=0; fail=0; skip=0

reset_skill_state() {
  rm -rf "$TMP_WORK"
}

run_test() {
  local name=$1; local fn=$2
  local rc
  set +e
  "$fn"; rc=$?
  set -e
  case "$rc" in
    0)   echo "PASS: $name"; pass=$((pass+1)) ;;
    77)  echo "SKIP: $name"; skip=$((skip+1)) ;;
    *)   echo "FAIL: $name (rc=$rc)"; fail=$((fail+1)) ;;
  esac
}

# 1. No argument → usage + exit 2.
test_usage_no_arg() {
  reset_skill_state
  local out
  out=$("$PROPOSE" 2>&1)
  local rc=$?
  [ "$rc" = "2" ] || return 1
  echo "$out" | grep -q "Usage: propose.sh" || return 1
}

# 2. Bad target form (no slash) → exit 2.
test_usage_bad_form() {
  reset_skill_state
  local out
  out=$("$PROPOSE" notaslash 2>&1)
  local rc=$?
  [ "$rc" = "2" ] || return 1
  echo "$out" | grep -q "owner/repo" || return 1
}

# 3. TFMAN_SRC_DIR pointing at a non-tfman directory → exit 2.
test_invalid_source_dir() {
  reset_skill_state
  local fakesrc; fakesrc=$(mktemp -d)
  local out
  out=$(TFMAN_SRC_DIR="$fakesrc" "$PROPOSE" yyoda/tfman 2>&1)
  local rc=$?
  rm -rf "$fakesrc"
  [ "$rc" = "2" ] || return 1
  echo "$out" | grep -q "does not look like a tfman checkout" || return 1
}

# 4. Corrupt tmp/work/<slug> (no .git) → exit 3.
#    The source validation must pass first, so use the real tfman checkout as
#    the source (the one that hosts this skill).
test_exit3_corrupt_work() {
  reset_skill_state
  mkdir -p "$TMP_WORK/yyoda__tfman"
  echo junk > "$TMP_WORK/yyoda__tfman/junk.txt"
  "$PROPOSE" yyoda/tfman >/dev/null 2>&1
  local rc=$?
  [ "$rc" = "3" ]
}

# 5. Self-update happy path: target == upstream of source -> "No changes",
#    exit 0. Skipped when gh is not authenticated or network is unavailable.
test_no_change_self_update() {
  if ! command -v gh >/dev/null 2>&1; then return 77; fi
  if ! gh auth status >/dev/null 2>&1; then return 77; fi
  reset_skill_state
  local out
  out=$(PROPOSE_DRY_RUN=1 "$PROPOSE" yyoda/tfman 2>&1)
  local rc=$?
  [ "$rc" = "0" ] || { echo "$out" >&2; return 1; }
  echo "$out" | grep -q "No changes" || { echo "$out" >&2; return 1; }
}

run_test "usage on no arg"                    test_usage_no_arg
run_test "usage on bad target form"           test_usage_bad_form
run_test "exit 2 on invalid TFMAN_SRC_DIR"    test_invalid_source_dir
run_test "exit 3 on corrupt work clone"       test_exit3_corrupt_work
run_test "no-change self-update (dry run)"    test_no_change_self_update

reset_skill_state

echo
echo "Summary: PASS=$pass  FAIL=$fail  SKIP=$skip"
[ "$fail" -eq 0 ]
