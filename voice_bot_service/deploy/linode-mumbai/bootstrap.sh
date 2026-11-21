#!/usr/bin/env bash
# One-shot bootstrap for the Mumbai voice-bot anchor (fresh Ubuntu 24.04 LTS).
# Usage (as root):  curl -fsSL https://raw.githubusercontent.com/Vacademy-io/vacademy_edtech_platform/main/voice_bot_service/deploy/linode-mumbai/bootstrap.sh | bash
set -euo pipefail

RAW=https://raw.githubusercontent.com/Vacademy-io/vacademy_edtech_platform/main/voice_bot_service/deploy/linode-mumbai
DIR=/opt/voice-bot

echo "== Docker =="
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

echo "== Firewall =="
apt-get install -y -qq ufw >/dev/null
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo "== Files =="
mkdir -p "$DIR"
curl -fsSL "$RAW/docker-compose.yml" -o "$DIR/docker-compose.yml"
curl -fsSL "$RAW/Caddyfile" -o "$DIR/Caddyfile"

if [ ! -f "$DIR/.env" ]; then
  curl -fsSL "$RAW/env.example" -o "$DIR/.env"
  echo ""
  echo ">>> Wrote $DIR/.env from the template."
  echo ">>> Fill in VOICE_BOT_CLIENT_SECRET, SARVAM_API_KEY, GEMINI_API_KEY, then run:"
  echo ">>>     cd $DIR && docker compose up -d"
  exit 0
fi

cd "$DIR"
docker compose pull
docker compose up -d
echo "== Up. Verify: curl -s https://voice-bot-in.vacademy.io/voice-bot-service/health =="
