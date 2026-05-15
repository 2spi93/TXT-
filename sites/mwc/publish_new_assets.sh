#!/usr/bin/env bash
set -euo pipefail
SRC=/opt/hermes/data/home/dropshipping-ops/mwc-site-bridge
DST=/opt/txt/sites/mwc
mkdir -p "$DST"
rsync -av --exclude 'README.txt' --exclude 'index.snapshot.*.html' --exclude 'publish_new_assets.sh' "$SRC"/ "$DST"/
