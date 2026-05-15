#!/usr/bin/env bash
set -euo pipefail

STAGING_ROOT="/opt/hermes/data/home/mwc-live-staging/opt/txt/sites/mwc"
LIVE_ROOT="/opt/txt/sites/mwc"

if [ ! -d "$STAGING_ROOT" ]; then
  echo "Staging root missing: $STAGING_ROOT" >&2
  exit 1
fi

if [ ! -d "$LIVE_ROOT" ] || [ ! -w "$LIVE_ROOT" ]; then
  echo "Live root unavailable or not writable from this session: $LIVE_ROOT" >&2
  exit 1
fi

python3 - "$STAGING_ROOT" "$LIVE_ROOT" <<'PY'
from pathlib import Path
import shutil
import sys

src = Path(sys.argv[1])
dest = Path(sys.argv[2])
exclude = {'logs', 'backups', '.autopublish', '.autopublish-hermes', '.deploy-request', 'deploy-request.latest.txt'}
for child in src.iterdir():
    if child.name in exclude:
        continue
    target = dest / child.name
    if child.is_dir():
        if target.exists() and not target.is_dir():
            target.unlink()
        shutil.copytree(child, target, dirs_exist_ok=True)
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(child, target)
print(f'Synced {src} -> {dest}')
PY
