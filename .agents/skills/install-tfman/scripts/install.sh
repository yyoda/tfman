#!/usr/bin/env bash
# Sync .github/scripts and .github/workflows from yyoda/tfman into the CWD.
# Idempotent: re-running against the same upstream revision is a no-op.
# Exits non-zero with line + command on any failure.
set -euo pipefail
trap 'status=$?; echo "install-tfman: failed at line $LINENO ($BASH_COMMAND) with exit $status" >&2; exit $status' ERR

# Upstream repository. Override via env var to point at a fork / mirror.
TFMAN_REPO_URL="${TFMAN_REPO_URL:-https://github.com/yyoda/tfman.git}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP_DIR="$SKILL_DIR/tmp"
CLONE_DIR="$TMP_DIR/tfman"
TARGET_DIR="$(pwd)"

mkdir -p "$TMP_DIR"

if [ -d "$CLONE_DIR/.git" ]; then
  echo "Updating existing clone in $CLONE_DIR ..."
  # fetch + reset rather than pull --ff-only: stays robust if upstream rebases or
  # force-pushes, which would make a shallow ff-only pull fail.
  git -C "$CLONE_DIR" fetch --depth=1 origin HEAD
  git -C "$CLONE_DIR" reset --hard FETCH_HEAD
elif [ -e "$CLONE_DIR" ]; then
  echo "Error: $CLONE_DIR exists but is not a git clone (interrupted previous run?)." >&2
  echo "Inspect and remove it manually, then re-run." >&2
  exit 3
else
  echo "Cloning $TFMAN_REPO_URL into $CLONE_DIR ..."
  git clone --depth=1 "$TFMAN_REPO_URL" "$CLONE_DIR"
fi

mkdir -p "$TARGET_DIR/.github/scripts" "$TARGET_DIR/.github/workflows"

echo "Copying .github/scripts/ ..."
cp -R "$CLONE_DIR/.github/scripts/." "$TARGET_DIR/.github/scripts/"

echo "Copying .github/workflows/ ..."
cp -R "$CLONE_DIR/.github/workflows/." "$TARGET_DIR/.github/workflows/"

echo "Done. Review changes with: git status && git diff -- .github/scripts .github/workflows"
