#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-/root/txt}"
BACKUP_DIR="${ROOT_DIR}/.migration-backup-$(date +%Y%m%d-%H%M%S)"

if [[ ! -d "$ROOT_DIR" ]]; then
  echo "[error] Root directory not found: $ROOT_DIR" >&2
  exit 1
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "[error] Run as root (sudo)" >&2
  exit 1
fi

echo "[1/8] Backup compose and scripts"
mkdir -p "$BACKUP_DIR"
cp -a "$ROOT_DIR/docker-compose.yml" "$BACKUP_DIR/" || true
cp -a "$ROOT_DIR/docker-compose.distributed.yml" "$BACKUP_DIR/" || true
cp -a "$ROOT_DIR/scripts" "$BACKUP_DIR/" || true

echo "[2/8] Detect Docker"
command -v docker >/dev/null 2>&1 || { echo "[error] docker is not installed" >&2; exit 1; }
docker --version

echo "[3/8] Install Compose v2 plugin if missing"
if docker compose version >/dev/null 2>&1; then
  echo "[ok] docker compose v2 already available"
else
  apt-get update -y
  apt-get install -y docker-compose-plugin
  docker compose version
fi

echo "[4/8] Freeze legacy v1 binary if present"
if command -v docker-compose >/dev/null 2>&1; then
  LEGACY_PATH="$(command -v docker-compose)"
  mv "$LEGACY_PATH" "${LEGACY_PATH}.v1.bak.$(date +%s)" || true
  cat >/usr/local/bin/docker-compose <<'EOF'
#!/usr/bin/env bash
exec docker compose "$@"
EOF
  chmod +x /usr/local/bin/docker-compose
  echo "[ok] docker-compose now forwards to docker compose"
fi

echo "[5/8] Compose config validation"
cd "$ROOT_DIR"
docker compose -f docker-compose.yml config >/dev/null
if [[ -f docker-compose.distributed.yml ]]; then
  docker compose -f docker-compose.yml -f docker-compose.distributed.yml config >/dev/null
fi

echo "[6/8] Controlled restart core stack"
docker compose -f docker-compose.yml up -d

echo "[7/8] Health checks"
curl -fsS http://127.0.0.1:3000/ >/dev/null && echo "[ok] gateway"
curl -fsS http://127.0.0.1:8000/health >/dev/null && echo "[ok] control-plane"
curl -fsS http://127.0.0.1:8003/health >/dev/null && echo "[ok] market-data"

echo "[8/8] Done"
echo "Backup: $BACKUP_DIR"
echo "Compose v2 migration completed successfully."
