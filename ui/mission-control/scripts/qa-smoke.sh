#!/usr/bin/env sh
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "[qa:smoke] 1/3 Risk workspace integration"
node scripts/risk-workspace.integration.js

echo "[qa:smoke] 2/3 TypeScript + Next production build"
npm run build

echo "[qa:smoke] 3/3 Completed"
