#!/usr/bin/env bash
# ============================================================
# setup-ax41.sh — Installation & optimisation Hetzner AX41-NVMe
# À exécuter en root sur le nouveau serveur APRÈS scp/rsync
# Usage: bash /root/txt/deploy/setup-ax41.sh
# ============================================================
set -euo pipefail

STACK_DIR="/root/txt"
SERVICE_FILE="$STACK_DIR/deploy/txt-stack.service"

echo "=== [1/7] Mise à jour système ==="
apt-get update && apt-get upgrade -y

echo "=== [2/7] Installation Docker ==="
if ! command -v docker &>/dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
else
    echo "Docker déjà installé: $(docker --version)"
fi

echo "=== [3/7] Installation Ollama (modèles locaux) ==="
if ! command -v ollama &>/dev/null; then
    curl -fsSL https://ollama.ai/install.sh | sh
    systemctl enable ollama
    systemctl start ollama
    sleep 3
    echo "Téléchargement des modèles configurés dans .env..."
    ollama pull qwen2.5:3b-instruct
    ollama pull deepseek-r1:14b
    ollama pull nomic-embed-text
else
    echo "Ollama déjà installé"
fi

echo "=== [4/7] Configuration Docker daemon (logs + ulimits) ==="
mkdir -p /etc/docker
# Sauvegarder si fichier existant
[ -f /etc/docker/daemon.json ] && cp /etc/docker/daemon.json /etc/docker/daemon.json.bak
cp "$STACK_DIR/deploy/docker-daemon.json" /etc/docker/daemon.json
systemctl restart docker
sleep 2

echo "=== [5/7] Paramètres noyau pour perf réseau & fichiers ==="
cat >> /etc/sysctl.conf << 'SYSCTL'

# TXT AX41-NVMe optimisations
net.core.somaxconn = 65535
net.core.netdev_max_backlog = 65535
net.ipv4.tcp_max_syn_backlog = 65535
fs.file-max = 2097152
vm.swappiness = 10
vm.dirty_ratio = 40
vm.dirty_background_ratio = 10
SYSCTL
sysctl -p

echo "=== [6/7] Systemd service auto-start ==="
cp "$SERVICE_FILE" /etc/systemd/system/txt-stack.service
systemctl daemon-reload
systemctl enable txt-stack.service

echo "=== [7/7] Régénération du secret HMAC (ancienne valeur exposée) ==="
openssl rand -hex 32 > "$STACK_DIR/secrets/approval_hmac_secret"
chmod 600 "$STACK_DIR/secrets/"*
echo "Nouveau secret généré : $(cat $STACK_DIR/secrets/approval_hmac_secret)"

echo ""
echo "============================================================"
echo "  Setup terminé ! Lancez le stack avec :"
echo "    cd $STACK_DIR && docker compose up -d --build"
echo "  Ou via systemd :"
echo "    systemctl start txt-stack"
echo "============================================================"
