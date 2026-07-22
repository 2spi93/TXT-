#!/bin/sh
set -eu

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
HOST_HEADER="${HOST_HEADER:-app.txt.gtixt.com}"
USERNAME="${USERNAME:-operator}"
PASSWORD_FILE="${PASSWORD_FILE:-/workspace/secrets/default_operator_password}"

if [ ! -f "$PASSWORD_FILE" ]; then
  echo "missing_password_file=$PASSWORD_FILE" >&2
  exit 1
fi

PASSWORD="$(tr -d '\n' < "$PASSWORD_FILE")"
LOGIN_FORM="/tmp/mc_live_login_form.txt"
LOGIN_ERR="/tmp/mc_live_login_err.txt"
LOGIN_OUT="/tmp/mc_live_login_out.html"

rm -f "$LOGIN_FORM" "$LOGIN_ERR" "$LOGIN_OUT" /tmp/mc_live_page_*.html /tmp/mc_live_page_*.headers
printf 'username=%s&password=%s&next=/terminal' "$USERNAME" "$PASSWORD" > "$LOGIN_FORM"

wget -S -O "$LOGIN_OUT" \
  --header="Host: $HOST_HEADER" \
  --header="Content-Type: application/x-www-form-urlencoded" \
  --post-file="$LOGIN_FORM" \
  "$BASE_URL/api/auth/login" \
  >/dev/null 2>"$LOGIN_ERR" || true

echo "LOGIN"
grep -E 'HTTP/|Location:|Set-Cookie:' "$LOGIN_ERR" || true

COOKIE_HEADER="$({
  awk '
    /^[[:space:]]*[Ss]et-[Cc]ookie:/ {
      line = $0
      sub(/^[[:space:]]*[Ss]et-[Cc]ookie:[[:space:]]*/, "", line)
      sub(/;.*$/, "", line)
      if (length(line) > 0) {
        if (out != "") out = out "; "
        out = out line
      }
    }
    END { print out }
  ' "$LOGIN_ERR"
} | tr -d '\n')"

echo "COOKIE_HEADER_PRESENT=$( [ -n "$COOKIE_HEADER" ] && echo yes || echo no )"

fetch_page() {
  path="$1"
  label="$2"
  out="/tmp/mc_live_page_${label}.html"
  headers="/tmp/mc_live_page_${label}.headers"
  wget -S -O "$out" \
    --header="Host: $HOST_HEADER" \
    --header="Cookie: $COOKIE_HEADER" \
    "$BASE_URL$path" \
    >/dev/null 2>"$headers" || true
  code="$(awk '/HTTP\/1\.[01]/ { code = $2 } END { print code }' "$headers")"
  bytes="$(wc -c < "$out" | tr -d ' ')"
  echo "$path code=${code:-na} bytes=$bytes"
}

fetch_page "/" "root"
fetch_page "/dashboard" "dashboard"
fetch_page "/live-readiness" "live_readiness"
fetch_page "/incidents" "incidents"
fetch_page "/terminal" "terminal"

TERMINAL_PAGE="/tmp/mc_live_page_terminal.html"
echo "terminal_has_summary=$(grep -q 'Desk Summary' "$TERMINAL_PAGE" && echo yes || echo no)"
echo "terminal_has_toggle=$(grep -Eq 'Afficher modules experts|Masquer modules experts' "$TERMINAL_PAGE" && echo yes || echo no)"

if grep -Riq 'Walkthrough' /tmp/mc_live_page_root.html /tmp/mc_live_page_dashboard.html /tmp/mc_live_page_live_readiness.html /tmp/mc_live_page_incidents.html /tmp/mc_live_page_terminal.html; then
  echo "pages_have_walkthrough=yes"
else
  echo "pages_have_walkthrough=no"
fi