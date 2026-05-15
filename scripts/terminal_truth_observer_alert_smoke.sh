#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${ROOT_DIR:-/opt/txt}"
# shellcheck source=./lib/control_plane_helpers.sh
. "$SCRIPT_DIR/lib/control_plane_helpers.sh"

txt_source_repo_env

WEBHOOK_URL="${WEBHOOK_URL:-}"
WEBHOOK_URL_FILE="${WEBHOOK_URL_FILE:-$ROOT_DIR/secrets/terminal_truth_observer_webhook_url}"
WEBHOOK_TIMEOUT_SEC="${WEBHOOK_TIMEOUT_SEC:-10}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_BOT_TOKEN_FILE="${TELEGRAM_BOT_TOKEN_FILE:-$ROOT_DIR/secrets/telegram_bot_token}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
TELEGRAM_CHAT_ID_FILE="${TELEGRAM_CHAT_ID_FILE:-$ROOT_DIR/secrets/telegram_chat_id}"
TELEGRAM_TOPIC_ID="${TELEGRAM_TOPIC_ID:-}"
TELEGRAM_DISABLE_NOTIFICATION="${TELEGRAM_DISABLE_NOTIFICATION:-0}"
TELEGRAM_API_BASE_URL="${TELEGRAM_API_BASE_URL:-https://api.telegram.org}"
STATUS="${STATUS:-degraded}"
REASON="${REASON:-manual_smoke_test}"
SLOT="${SLOT:-manual}"
CONTAINER_NAME="${CONTAINER_NAME:-manual-smoke}"
BASE_URL="${BASE_URL:-manual://terminal-truth-observer}"
TERMINAL_URL="${TERMINAL_URL:-manual://terminal-truth-observer/test}"
ALERT_TEXT_RENDERER="${ALERT_TEXT_RENDERER:-$ROOT_DIR/scripts/lib/terminal_truth_alert_text.js}"

usage() {
  cat <<'EOF'
Usage: terminal_truth_observer_alert_smoke.sh [options]

Options:
  --status VALUE                Status to embed in the synthetic record (default: degraded)
  --reason VALUE                Reason to embed in the synthetic record (default: manual_smoke_test)
  --slot VALUE                  Slot label (default: manual)
  --container VALUE             Container label (default: manual-smoke)
  --base-url VALUE              Base URL label (default: manual://terminal-truth-observer)
  --terminal-url VALUE          Terminal URL label (default: manual://terminal-truth-observer/test)
  --webhook-url VALUE           Explicit webhook URL override
  --telegram-chat-id VALUE      Explicit Telegram chat id override
  --telegram-topic-id VALUE     Telegram topic/thread id override
  --disable-notification        Disable Telegram notification sound
  -h, --help                    Show help

Behavior:
  - Uses Telegram if TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are resolved.
  - Otherwise uses WEBHOOK_URL if resolved.
  - Reads *_FILE secrets using the repo helper just like the observer service.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --status) STATUS="$2"; shift 2 ;;
    --reason) REASON="$2"; shift 2 ;;
    --slot) SLOT="$2"; shift 2 ;;
    --container) CONTAINER_NAME="$2"; shift 2 ;;
    --base-url) BASE_URL="$2"; shift 2 ;;
    --terminal-url) TERMINAL_URL="$2"; shift 2 ;;
    --webhook-url) WEBHOOK_URL="$2"; shift 2 ;;
    --telegram-chat-id) TELEGRAM_CHAT_ID="$2"; shift 2 ;;
    --telegram-topic-id) TELEGRAM_TOPIC_ID="$2"; shift 2 ;;
    --disable-notification) TELEGRAM_DISABLE_NOTIFICATION="1"; shift 1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
done

WEBHOOK_URL="$(txt_resolve_secret "$WEBHOOK_URL" "$WEBHOOK_URL_FILE" || true)"
TELEGRAM_BOT_TOKEN="$(txt_resolve_secret "$TELEGRAM_BOT_TOKEN" "$TELEGRAM_BOT_TOKEN_FILE" || true)"
TELEGRAM_CHAT_ID="$(txt_resolve_secret "$TELEGRAM_CHAT_ID" "$TELEGRAM_CHAT_ID_FILE" || true)"

RECORD="$(STATUS="$STATUS" REASON="$REASON" SLOT="$SLOT" CONTAINER_NAME="$CONTAINER_NAME" BASE_URL="$BASE_URL" TERMINAL_URL="$TERMINAL_URL" node - <<'NODE'
const now = new Date().toISOString();
process.stdout.write(JSON.stringify({
  iteration: 1,
  capturedAt: now,
  hostCapturedAt: now,
  status: process.env.STATUS,
  reason: process.env.REASON,
  slot: process.env.SLOT,
  container: process.env.CONTAINER_NAME,
  baseUrl: process.env.BASE_URL,
  terminalUrl: process.env.TERMINAL_URL,
  readyMs: null,
  state: null,
  responseErrors: [],
  requestFailures: [],
  consoleEvents: [],
  pageErrors: [],
}));
NODE
)"

ALERT_TEXT="$(node "$ALERT_TEXT_RENDERER" "$RECORD")"

if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
  TELEGRAM_RESPONSE="$(RECORD="$RECORD" ALERT_TEXT="$ALERT_TEXT" TELEGRAM_CHAT_ID="$TELEGRAM_CHAT_ID" TELEGRAM_TOPIC_ID="$TELEGRAM_TOPIC_ID" TELEGRAM_DISABLE_NOTIFICATION="$TELEGRAM_DISABLE_NOTIFICATION" TELEGRAM_BOT_TOKEN="$TELEGRAM_BOT_TOKEN" TELEGRAM_API_BASE_URL="$TELEGRAM_API_BASE_URL" WEBHOOK_TIMEOUT_SEC="$WEBHOOK_TIMEOUT_SEC" python3 - <<'PY'
import json
import os
import ssl
import sys
import urllib.request

payload = {
    "chat_id": os.environ["TELEGRAM_CHAT_ID"],
  "text": os.environ["ALERT_TEXT"],
    "disable_web_page_preview": True,
    "disable_notification": os.environ.get("TELEGRAM_DISABLE_NOTIFICATION") == "1",
}
topic_id = os.environ.get("TELEGRAM_TOPIC_ID", "").strip()
if topic_id:
    payload["message_thread_id"] = int(topic_id)

request = urllib.request.Request(
    f"{os.environ['TELEGRAM_API_BASE_URL'].rstrip('/')}/bot{os.environ['TELEGRAM_BOT_TOKEN']}/sendMessage",
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(request, timeout=int(os.environ.get("WEBHOOK_TIMEOUT_SEC", "10")), context=ssl.create_default_context()) as response:
    body = response.read().decode("utf-8")
sys.stdout.write(body)
PY
)"
  printf '%s\n' "$TELEGRAM_RESPONSE"
  exit 0
fi

if [ -z "$WEBHOOK_URL" ]; then
  echo '{"status":"error","reason":"no_alert_transport_configured"}' >&2
  exit 3
fi

WEBHOOK_RESPONSE="$(RECORD="$RECORD" WEBHOOK_URL="$WEBHOOK_URL" WEBHOOK_TIMEOUT_SEC="$WEBHOOK_TIMEOUT_SEC" python3 - <<'PY'
import os
import ssl
import sys
import urllib.request

request = urllib.request.Request(
    os.environ["WEBHOOK_URL"],
    data=os.environ["RECORD"].encode("utf-8"),
    headers={"Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(request, timeout=int(os.environ.get("WEBHOOK_TIMEOUT_SEC", "10")), context=ssl.create_default_context()) as response:
    sys.stdout.write(response.read().decode("utf-8"))
PY
)"
printf '%s\n' "$WEBHOOK_RESPONSE"