#!/usr/bin/env bash
# Bootstrap the bridge on any fresh Ubuntu/Debian VPS (Hetzner, DigitalOcean,
# Lightsail, …). Installs Docker, clones the repo, prepares .env, and starts
# the bridge-only compose stack. Run as root:
#   curl -fsSL https://raw.githubusercontent.com/adamperlis/slack-to-buzz-bridge/main/deploy/setup-vps.sh | sudo bash
set -euo pipefail

REPO_URL="https://github.com/adamperlis/slack-to-buzz-bridge.git"
INSTALL_DIR="/opt/slack-buzz"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

echo "==> Installing Docker (if missing)…"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

echo "==> Fetching the bridge…"
if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" pull --ff-only
else
  apt-get install -y -q git >/dev/null 2>&1 || true
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  MASTER_KEY=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
  sed -i "s/^BRIDGE_MASTER_KEY=.*/BRIDGE_MASTER_KEY=$MASTER_KEY/" .env
  echo ""
  echo "==> Created $INSTALL_DIR/.env with a generated master key."
  echo "    Now edit it with your values:"
  echo "      nano $INSTALL_DIR/.env        # Slack credentials, PUBLIC_BASE_URL, BUZZ_RELAY_URL"
  echo "      nano $INSTALL_DIR/deploy/Caddyfile.bridge-only   # your domain"
  echo "    Then start the bridge:"
  echo "      cd $INSTALL_DIR/deploy && docker compose -f docker-compose.bridge-only.yml up -d --build"
  exit 0
fi

echo "==> .env exists — (re)starting the bridge…"
cd deploy
docker compose -f docker-compose.bridge-only.yml up -d --build
docker compose -f docker-compose.bridge-only.yml ps
echo "==> Done. Verify: curl -s https://<your-domain>/healthz"
