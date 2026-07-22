#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${ROOT_DIR:-/opt/txt}"
# shellcheck source=./lib/control_plane_helpers.sh
. "$SCRIPT_DIR/lib/control_plane_helpers.sh"

txt_source_repo_env

TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_BOT_TOKEN_FILE="${TELEGRAM_BOT_TOKEN_FILE:-$ROOT_DIR/secrets/telegram_bot_token}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
TELEGRAM_CHAT_ID_FILE="${TELEGRAM_CHAT_ID_FILE:-$ROOT_DIR/secrets/telegram_chat_id}"
TELEGRAM_API_BASE_URL="${TELEGRAM_API_BASE_URL:-https://api.telegram.org}"

usage() {
  cat <<'EOF'
Usage: telegram_chat_probe.sh [options]

Options:
  --chat-id VALUE              Explicit Telegram chat id or channel username
  --token VALUE                Explicit bot token override
  -h, --help                   Show help

Behavior:
  - Resolves token and chat target from *_FILE secrets by default.
  - Calls getMe to confirm bot identity.
  - Calls getChat when a chat target is available.
  - Prints a compact JSON summary suitable for terminal use.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --chat-id) TELEGRAM_CHAT_ID="$2"; shift 2 ;;
    --token) TELEGRAM_BOT_TOKEN="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
done

TELEGRAM_BOT_TOKEN="$(txt_resolve_secret "$TELEGRAM_BOT_TOKEN" "$TELEGRAM_BOT_TOKEN_FILE" || true)"
TELEGRAM_CHAT_ID="$(txt_resolve_secret "$TELEGRAM_CHAT_ID" "$TELEGRAM_CHAT_ID_FILE" || true)"

if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
  echo '{"status":"error","reason":"telegram_bot_token_missing"}' >&2
  exit 3
fi

TELEGRAM_BOT_TOKEN="$TELEGRAM_BOT_TOKEN" TELEGRAM_CHAT_ID="$TELEGRAM_CHAT_ID" TELEGRAM_API_BASE_URL="$TELEGRAM_API_BASE_URL" python3 - <<'PY'
import json
import os
import ssl
import sys
import urllib.parse
import urllib.request


def call(method: str, params: dict | None = None) -> dict:
    url = f"{os.environ['TELEGRAM_API_BASE_URL'].rstrip('/')}/bot{os.environ['TELEGRAM_BOT_TOKEN']}/{method}"
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(request, timeout=15, context=ssl.create_default_context()) as response:
        return json.loads(response.read().decode("utf-8"))


summary: dict[str, object] = {
    "status": "ok",
}

try:
    me = call("getMe")
except Exception as exc:
    print(json.dumps({"status": "error", "reason": "telegram_getMe_failed", "error": str(exc)}))
    raise SystemExit(1)

summary["bot"] = me.get("result", {}) if isinstance(me, dict) else {}

chat_target = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
if not chat_target:
    summary["chat"] = None
    print(json.dumps(summary))
    raise SystemExit(0)

try:
    chat = call("getChat", {"chat_id": chat_target})
except Exception as exc:
    print(json.dumps({
        "status": "error",
        "reason": "telegram_getChat_failed",
        "chatTarget": chat_target,
        "error": str(exc),
        "bot": summary["bot"],
    }))
    raise SystemExit(4)

summary["chatTarget"] = chat_target
summary["chat"] = chat.get("result", {}) if isinstance(chat, dict) else {}
print(json.dumps(summary))
PY