#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
MC_UI_DIR="$ROOT_DIR/ui/mission-control"

if ! command -v docker >/dev/null 2>&1; then
  echo "[qa:wrapper] docker is required"
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "[qa:wrapper] docker compose plugin is required"
  exit 1
fi

ACTIVE_SLOT_FILE="$ROOT_DIR/data/mission-control/ui-active-slot.conf"
MC_UI_SERVICE="mission-control-ui-blue"
if [ -f "$ACTIVE_SLOT_FILE" ] && grep -q 'mission-control-ui-green:3002' "$ACTIVE_SLOT_FILE"; then
  MC_UI_SERVICE="mission-control-ui-green"
fi

echo "[qa:wrapper] 1/2 Smoke QA in $MC_UI_SERVICE container"
cd "$ROOT_DIR"
docker compose run --rm "$MC_UI_SERVICE" sh -lc "npm ci --no-audit --no-fund && npm run qa:smoke"

echo "[qa:wrapper] 2/2 UI regression in pinned Playwright image"
cd "$MC_UI_DIR"
sh scripts/qa-regression-ui.sh

echo "[qa:wrapper] Completed: smoke + reproducible e2e"