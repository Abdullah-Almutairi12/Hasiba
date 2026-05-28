#!/usr/bin/env bash
# scripts/docs-capture.sh
# ------------------------------------------------------------------
# Refresh the user-manual screenshots from a live, locally-running
# copy of the ERP. Encapsulates everything that used to be manual:
#   * exporting LD_LIBRARY_PATH so Playwright's bundled chromium can
#     dlopen libgbm + libsystemd on NixOS
#   * installing chromium under ~/.cache/ms-playwright if absent
#   * spawning api-server + erp-system in the background
#   * waiting for both to answer through the shared proxy at :80
#   * upserting a dedicated capture user (manager role)
#   * running the Playwright capture
#   * tearing the background services down on exit
#
# SAFETY GATE — this script provisions a manager-role account and
# captures unauthenticated PNGs into the public docs site. To prevent
# accidental use against a production tenant, you MUST opt in by
# setting:
#
#   DOCS_CAPTURE_DEMO_TENANT_ACK=1
#
# AND you MUST provide both DOCS_CAPTURE_EMAIL and a strong
# DOCS_CAPTURE_PASSWORD (>= 16 chars). No defaults are baked in for
# the credentials.
#
# Exit code is the capture script's exit code; the script never wipes
# previously-captured PNGs on failure.
# ------------------------------------------------------------------
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

log() { echo "[docs:capture] $*"; }
die() { log "ERROR: $*"; exit 1; }

# ---------- 0. Safety gate ----------------------------------------
if [[ "${DOCS_CAPTURE_DEMO_TENANT_ACK:-}" != "1" ]]; then
  log "refusing to run: DOCS_CAPTURE_DEMO_TENANT_ACK!=1."
  log "this command provisions a manager-role bot user and writes"
  log "unauthenticated PNGs into artifacts/docs/public/screenshots/."
  log "set DOCS_CAPTURE_DEMO_TENANT_ACK=1 only when pointed at a"
  log "dedicated demo tenant — never at a production tenant."
  exit 0
fi

if [[ -z "${DOCS_CAPTURE_EMAIL:-}" ]]; then
  die "DOCS_CAPTURE_EMAIL is required (no default)."
fi
if [[ -z "${DOCS_CAPTURE_PASSWORD:-}" ]]; then
  die "DOCS_CAPTURE_PASSWORD is required (no default)."
fi
if (( ${#DOCS_CAPTURE_PASSWORD} < 16 )); then
  die "DOCS_CAPTURE_PASSWORD must be >= 16 characters (manager role)."
fi
export DOCS_CAPTURE_EMAIL DOCS_CAPTURE_PASSWORD

# ---------- 1. LD_LIBRARY_PATH for Playwright's chromium ----------
add_lib() {
  # $1 = glob pattern under /nix/store
  local match
  match=$(compgen -G "$1" 2>/dev/null | head -1 || true)
  if [[ -n "$match" ]]; then
    local dir
    dir=$(dirname "$match")
    case ":${LD_LIBRARY_PATH:-}:" in
      *":$dir:"*) ;;
      *) LD_LIBRARY_PATH="${LD_LIBRARY_PATH:+$LD_LIBRARY_PATH:}$dir" ;;
    esac
  else
    log "warn: no match for $1 — chromium may fail to start"
  fi
}

add_lib "/nix/store/*mesa-*/lib/libgbm.so*"
add_lib "/nix/store/*systemd-minimal-*/lib/libsystemd.so*"
add_lib "/nix/store/*systemd-minimal-libs-*/lib/libsystemd.so*"
export LD_LIBRARY_PATH
log "LD_LIBRARY_PATH=${LD_LIBRARY_PATH:-<empty>}"

# ---------- 2. Install chromium if missing ------------------------
PW_BIN="$ROOT_DIR/scripts/node_modules/.bin/playwright"
if [[ ! -x "$PW_BIN" ]]; then
  die "playwright is not installed in @workspace/scripts — run pnpm install first"
fi
if ! ls "${HOME}/.cache/ms-playwright"/chromium-* >/dev/null 2>&1; then
  log "installing chromium browser bundle…"
  (cd "$ROOT_DIR/scripts" && "$PW_BIN" install chromium) || die "chromium install failed"
fi

# ---------- 3. Start backing services in the background -----------
LOG_DIR="$ROOT_DIR/.local/docs-capture"
mkdir -p "$LOG_DIR"
API_LOG="$LOG_DIR/api-server.log"
WEB_LOG="$LOG_DIR/erp-system.log"
PIDS=()

cleanup() {
  log "shutting down background services…"
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      pkill -TERM -P "$pid" 2>/dev/null || true
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done
  sleep 1
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      pkill -KILL -P "$pid" 2>/dev/null || true
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT INT TERM

start_service() {
  local name="$1" cmd="$2" log_file="$3"
  if pgrep -f "$cmd" >/dev/null 2>&1; then
    log "$name already running — reusing"
    return
  fi
  log "starting $name (logs: $log_file)"
  ( cd "$ROOT_DIR" && bash -c "$cmd" >"$log_file" 2>&1 ) &
  PIDS+=("$!")
}

start_service "api-server" \
  "PORT=8080 NODE_ENV=development pnpm --filter @workspace/api-server run dev" \
  "$API_LOG"
start_service "erp-system" \
  "PORT=19692 BASE_PATH=/ pnpm --filter @workspace/erp-system run dev" \
  "$WEB_LOG"

# ---------- 4. Wait for both to be reachable through proxy --------
BASE_URL="${DOCS_CAPTURE_BASE_URL:-http://localhost:80}"
wait_for() {
  local url="$1" name="$2" tries=60
  log "waiting for $name at $url"
  for ((i = 1; i <= tries; i++)); do
    if curl -fsS -o /dev/null --max-time 2 "$url"; then
      log "$name is up after ${i}s"
      return 0
    fi
    sleep 1
  done
  log "$name did not come up after ${tries}s — last log:"
  case "$name" in
    api-server) tail -n 40 "$API_LOG" ;;
    erp-system) tail -n 40 "$WEB_LOG" ;;
  esac
  return 1
}

wait_for "$BASE_URL/api/healthz" "api-server" || exit 1
wait_for "$BASE_URL/" "erp-system" || exit 1

# ---------- 5. Ensure the capture user exists ---------------------
log "upserting capture user $DOCS_CAPTURE_EMAIL"
pnpm --filter @workspace/scripts run ensure-capture-user || die "could not upsert capture user"

# ---------- 6. Run the actual capture -----------------------------
export DOCS_CAPTURE_ENABLED=1
export DOCS_CAPTURE_BASE_URL="$BASE_URL"
log "capturing screenshots → artifacts/docs/public/screenshots/{ar,en}/"
pnpm --filter @workspace/scripts run capture-docs-screenshots
status=$?

log "done (exit=$status)"
exit "$status"
