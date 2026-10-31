#!/bin/bash
# Verify hook behavior without installing dependencies or connecting to a DB.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
cat > "$scratch/pnpm" <<'STUB'
#!/bin/bash
printf '%s\n' "$*" >> "$POST_MERGE_TEST_CALLS"
STUB
chmod +x "$scratch/pnpm"
export POST_MERGE_TEST_CALLS="$scratch/calls"
PATH="$scratch:$PATH" bash "$root/scripts/post-merge.sh"
printf '%s\n' 'install --frozen-lockfile' > "$scratch/expected"
diff -u "$scratch/expected" "$scratch/calls"
printf '%s\n' 'PASS: the post-merge hook only reconciles dependencies; no database or authenticated capture command runs.'
