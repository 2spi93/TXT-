#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${DOMAIN:-app.txt.gtixt.com}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEBROOT_DIR="${WEBROOT_DIR:-$ROOT_DIR/data/certbot/www}"
CONFIG_DIR="${CONFIG_DIR:-$ROOT_DIR/secrets/tls}"
WORK_DIR="${WORK_DIR:-$ROOT_DIR/data/certbot/work}"
LOGS_DIR="${LOGS_DIR:-$ROOT_DIR/logs/certbot}"
EMAIL="${TLS_ACME_EMAIL:-}"
LIVE_DIR="$CONFIG_DIR/live/$DOMAIN"
ARCHIVE_DIR="$CONFIG_DIR/archive/$DOMAIN"
RENEWAL_CONF="$CONFIG_DIR/renewal/$DOMAIN.conf"

mkdir -p "$WEBROOT_DIR" "$WORK_DIR" "$LOGS_DIR" "$CONFIG_DIR/live" "$CONFIG_DIR/renewal"

if [[ -d "$LIVE_DIR" && -f "$LIVE_DIR/fullchain.pem" && ! -L "$LIVE_DIR/fullchain.pem" && ! -d "$ARCHIVE_DIR" ]]; then
  backup_dir="$CONFIG_DIR/live/${DOMAIN}.selfsigned.$(date +%Y%m%d%H%M%S)"
  mv "$LIVE_DIR" "$backup_dir"
  rm -f "$RENEWAL_CONF"
fi

if ! command -v certbot >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y certbot
fi

cd "$ROOT_DIR"

docker compose -f docker-compose.yml up -d mission-control-gateway mission-control-tls

request_args=(
  certonly
  --webroot
  -w "$WEBROOT_DIR"
  -d "$DOMAIN"
  --non-interactive
  --agree-tos
  --config-dir "$CONFIG_DIR"
  --work-dir "$WORK_DIR"
  --logs-dir "$LOGS_DIR"
  --keep-until-expiring
)

if [[ -n "$EMAIL" ]]; then
  request_args+=(--email "$EMAIL")
else
  request_args+=(--register-unsafely-without-email)
fi

certbot "${request_args[@]}"

if [[ ! -s "$CONFIG_DIR/live/$DOMAIN/fullchain.pem" || ! -s "$CONFIG_DIR/live/$DOMAIN/privkey.pem" ]]; then
  echo "[fail] missing issued certificate files for $DOMAIN" >&2
  exit 1
fi

docker compose -f docker-compose.yml up -d mission-control-tls

echo "[ok] certificate available at $CONFIG_DIR/live/$DOMAIN"