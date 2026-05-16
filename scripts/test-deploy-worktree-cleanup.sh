#!/usr/bin/env bash
#
# Test deploy worktree cleanup
#
# Purpose:
# - Operational script for this repository's server/local workflows.
#
# Safety:
# - Mutating operation. Review target variables before running.
#
# Variables:
# - TARGET_ENV (optional), BASE_URL (default https://demo.bookmyclass.app), APP_DIR (default /var/www/bookmyclass), APP_NAME (default bookmyclass-app).
#
# Usage:
#   TARGET_ENV=staging BASE_URL=https://demo.bookmyclass.app bash scripts/test-deploy-worktree-cleanup.sh
#
set -euo pipefail

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

repo_dir="$tmp_dir/repo"
mkdir -p "$repo_dir"
cd "$repo_dir"

git init -q
git config user.name "deploy-test"
git config user.email "deploy-test@bookmyclass.app"

mkdir -p src scripts public/uploads uploads
echo "first" > src/changed.txt
git add .
git commit -qm "base"
git tag v1.0.0

echo "second" > src/changed.txt
echo "new content" > src/new.txt
echo "from-tag" > scripts/blocker.txt
git add -A
git commit -qm "next"
git tag v1.1.0

git checkout -q v1.0.0
echo "dirty" >> src/changed.txt
echo "local-env=true" > .env
mkdir -p uploads public/uploads scripts
echo "keep" > uploads/keep.txt
echo "keep-public" > public/uploads/keep.txt
echo "blocks checkout" > scripts/blocker.txt

RUN_DIR="$tmp_dir"
git diff -- > "${RUN_DIR}/remote-dirty-worktree.patch" || true
git status --short > "${RUN_DIR}/remote-dirty-worktree.status" || true
git reset --hard
git clean -ffd \
  -e .env \
  -e .env.local \
  -e '.env.*' \
  -e uploads \
  -e 'uploads/**' \
  -e public/uploads \
  -e 'public/uploads/**'

git checkout -q --detach v1.1.0

test -f .env
test -f uploads/keep.txt
test -f public/uploads/keep.txt
grep -q "^from-tag$" scripts/blocker.txt
grep -q "^second$" src/changed.txt
test -s "${RUN_DIR}/remote-dirty-worktree.status"

echo "[PASS] cleanup allows deterministic tag checkout and preserves env/uploads"

