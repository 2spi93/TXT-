#!/usr/bin/env sh
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

PLAYWRIGHT_DOCKER_IMAGE="${PLAYWRIGHT_DOCKER_IMAGE:-mcr.microsoft.com/playwright:v1.58.2-jammy}"
PLAYWRIGHT_BASE_URL="${PLAYWRIGHT_BASE_URL:-http://localhost:3310}"
PLAYWRIGHT_WEB_SERVER_COMMAND="${PLAYWRIGHT_WEB_SERVER_COMMAND:-npm run dev -- --hostname localhost --port 3310}"
MC_E2E_DEV_DEGRADED="${MC_E2E_DEV_DEGRADED:-1}"
CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-}"
CONTROL_PLANE_TOKEN="${CONTROL_PLANE_TOKEN:-}"

if ! command -v docker >/dev/null 2>&1; then
	echo "[qa:ui] docker is required to run reproducible Playwright regression"
	exit 1
fi

echo "[qa:ui] Running UI regression in ${PLAYWRIGHT_DOCKER_IMAGE}"
docker run --rm \
	-e PLAYWRIGHT_BASE_URL="$PLAYWRIGHT_BASE_URL" \
	-e PLAYWRIGHT_WEB_SERVER_COMMAND="$PLAYWRIGHT_WEB_SERVER_COMMAND" \
	-e MC_E2E_DEV_DEGRADED="$MC_E2E_DEV_DEGRADED" \
	-e CONTROL_PLANE_URL="$CONTROL_PLANE_URL" \
	-e CONTROL_PLANE_TOKEN="$CONTROL_PLANE_TOKEN" \
	-v "$ROOT_DIR:/work" \
	-w /work \
	"$PLAYWRIGHT_DOCKER_IMAGE" \
	/bin/bash -lc "npm ci --no-audit --no-fund && npm run test:e2e"
