#!/bin/sh
set -eu

cd /workspace/ui/mission-control

force_bootstrap="${FORCE_UI_BOOTSTRAP:-0}"

needs_install=0
if [ "$force_bootstrap" = "1" ] || [ ! -d node_modules ]; then
  needs_install=1
fi

needs_build=0
if [ "$force_bootstrap" = "1" ] || [ ! -f .next/BUILD_ID ]; then
  needs_build=1
fi

if [ "$needs_install" = "1" ]; then
  npm install
fi

if [ "$needs_build" = "1" ]; then
  npm run build
fi

build_id_file=".next/BUILD_ID"
current_build_id="$(cat "$build_id_file" 2>/dev/null || true)"
app_pid=""

start_server() {
  npm run start &
  app_pid=$!
}

stop_server() {
  if [ -n "$app_pid" ] && kill -0 "$app_pid" 2>/dev/null; then
    kill "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
  fi
  app_pid=""
}

trap 'stop_server; exit 0' INT TERM EXIT

start_server

while true; do
  if [ -n "$app_pid" ] && ! kill -0 "$app_pid" 2>/dev/null; then
    wait "$app_pid" 2>/dev/null || true
    start_server
  fi

  next_build_id="$(cat "$build_id_file" 2>/dev/null || true)"
  if [ -n "$next_build_id" ] && [ "$next_build_id" != "$current_build_id" ]; then
    current_build_id="$next_build_id"
    stop_server
    start_server
  fi

  sleep 2
done