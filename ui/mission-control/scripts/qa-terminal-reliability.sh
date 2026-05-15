#!/usr/bin/env sh
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

PLAYWRIGHT_DOCKER_IMAGE="${PLAYWRIGHT_DOCKER_IMAGE:-mcr.microsoft.com/playwright:v1.58.2-jammy}"
PLAYWRIGHT_BASE_URL="${PLAYWRIGHT_BASE_URL:-http://localhost:3328}"
PLAYWRIGHT_WEB_SERVER_COMMAND="${PLAYWRIGHT_WEB_SERVER_COMMAND:-sh scripts/playwright-web-server.sh}"
PLAYWRIGHT_OPERATOR_PASSWORD="${PLAYWRIGHT_OPERATOR_PASSWORD:-}"
NEXT_DIST_DIR="${NEXT_DIST_DIR:-.next-runtime}"
MC_E2E_DEV_DEGRADED="${MC_E2E_DEV_DEGRADED:-1}"
MC_E2E_DEV_DEGRADED_SILENT="${MC_E2E_DEV_DEGRADED_SILENT:-1}"
CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-https://api.txt.gtixt.com}"
PLAYWRIGHT_CONTROL_PLANE_URL="${PLAYWRIGHT_CONTROL_PLANE_URL:-$CONTROL_PLANE_URL}"
CONTROL_PLANE_TOKEN="${CONTROL_PLANE_TOKEN:-}"
PLAYWRIGHT_TEST_PATHS="${PLAYWRIGHT_TEST_PATHS:-tests/e2e/terminal-minimal-mode.spec.ts tests/e2e/terminal-interaction-scan.spec.ts}"
DOCKER_NETWORK_ARGS=""

if [ "$(uname -s)" = "Linux" ]; then
	DOCKER_NETWORK_ARGS="--network host"
fi

if ! command -v docker >/dev/null 2>&1; then
	echo "[qa:terminal-reliability] docker is required to run reproducible terminal reliability checks"
	exit 1
fi

echo "[qa:terminal-reliability] Running terminal reliability suite in ${PLAYWRIGHT_DOCKER_IMAGE}"
echo "[qa:terminal-reliability] Specs: ${PLAYWRIGHT_TEST_PATHS}"
docker run --rm \
	${DOCKER_NETWORK_ARGS} \
	--add-host=host.docker.internal:host-gateway \
	-e PLAYWRIGHT_BASE_URL="$PLAYWRIGHT_BASE_URL" \
	-e PLAYWRIGHT_WEB_SERVER_COMMAND="$PLAYWRIGHT_WEB_SERVER_COMMAND" \
	-e PLAYWRIGHT_OPERATOR_PASSWORD="$PLAYWRIGHT_OPERATOR_PASSWORD" \
	-e NEXT_DIST_DIR="$NEXT_DIST_DIR" \
	-e MC_E2E_DEV_DEGRADED="$MC_E2E_DEV_DEGRADED" \
	-e MC_E2E_DEV_DEGRADED_SILENT="$MC_E2E_DEV_DEGRADED_SILENT" \
	-e CONTROL_PLANE_URL="$CONTROL_PLANE_URL" \
	-e PLAYWRIGHT_CONTROL_PLANE_URL="$PLAYWRIGHT_CONTROL_PLANE_URL" \
	-e CONTROL_PLANE_TOKEN="$CONTROL_PLANE_TOKEN" \
	-v "$ROOT_DIR:/work" \
	-w /work \
	"$PLAYWRIGHT_DOCKER_IMAGE" \
	/bin/bash -lc 'set -eu
	npm ci --no-audit --no-fund
	cmd=(./node_modules/.bin/playwright test --workers=1 --reporter=line)
	for spec in $PLAYWRIGHT_TEST_PATHS; do
		cmd+=("$spec")
	done
	"${cmd[@]}"'