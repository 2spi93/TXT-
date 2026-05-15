#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
HOST_HEADER="${HOST_HEADER:-app.txt.gtixt.com}"
HOME_PATH="${HOME_PATH:-/}"
MAX_ASSET_COUNT="${MAX_ASSET_COUNT:-8}"

usage() {
  cat <<'EOF'
Usage: scripts/check_ui_static_assets.sh [options]

Fetch the HTML shell, extract current /_next/static asset URLs, and verify they return HTTP 200.

Options:
  --base-url URL        Base URL to fetch (default: http://127.0.0.1:3000)
  --host HOST           Host header to send (default: app.txt.gtixt.com)
  --path PATH           HTML path to inspect (default: /)
  --max-assets N        Max referenced assets to probe (default: 8)
  --help                Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)
      BASE_URL="$2"
      shift 2
      ;;
    --host)
      HOST_HEADER="$2"
      shift 2
      ;;
    --path)
      HOME_PATH="$2"
      shift 2
      ;;
    --max-assets)
      MAX_ASSET_COUNT="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

curl_args=(--max-time 20 -sSL -H "Host: $HOST_HEADER")
case "$BASE_URL" in
  https://*) curl_args=(-k "${curl_args[@]}") ;;
esac

html_file="$(mktemp)"
headers_file="$(mktemp)"
trap 'rm -f "$html_file" "$headers_file"' EXIT

curl "${curl_args[@]}" -D "$headers_file" -o "$html_file" "${BASE_URL%/}${HOME_PATH}"

final_code="$(awk 'toupper($1) ~ /^HTTP\// {code=$2} END {print code}' "$headers_file")"
content_type="$(awk 'BEGIN{IGNORECASE=1} /^content-type:/ {sub(/\r$/, "", $0); print substr($0, index($0,":") + 2)}' "$headers_file" | tail -1)"
if [[ "$final_code" != "200" ]]; then
  echo "[fail] final HTML response returned $final_code for ${BASE_URL%/}${HOME_PATH}" >&2
  exit 1
fi
if [[ "$content_type" != text/html* && "$content_type" != application/xhtml+xml* ]]; then
  echo "[fail] unexpected content-type '$content_type' for ${BASE_URL%/}${HOME_PATH}" >&2
  exit 1
fi

mapfile -t asset_paths < <(
  tr '"' '\n' < "$html_file" \
    | sed 's#\\$##' \
    | grep '^/_next/static/' \
    | awk '!seen[$0]++' \
    | sed -n "1,${MAX_ASSET_COUNT}p"
)

if [[ ${#asset_paths[@]} -eq 0 ]]; then
  if grep -Eq '<html|__NEXT_DATA__|self\.__next_f\.push|/_next/' "$html_file"; then
    echo "[ok]   HTML shell is present and looks like a Next.js response; no direct /_next/static references to validate"
    exit 0
  fi
  echo "[fail] no recognizable Next.js HTML markers found in ${BASE_URL%/}${HOME_PATH}" >&2
  exit 1
fi

for asset_path in "${asset_paths[@]}"; do
  code="$(curl "${curl_args[@]}" -o /dev/null -w '%{http_code}' "${BASE_URL%/}${asset_path}" || echo 000)"
  if [[ "$code" != "200" ]]; then
    echo "[fail] $asset_path -> $code" >&2
    exit 1
  fi
  echo "[ok]   $asset_path -> $code"
done

echo "[ok]   verified ${#asset_paths[@]} referenced Next static assets"