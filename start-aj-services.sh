#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="/home/ajserver/projects/project-openclaw/.env"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

: "${AJ_ROUTER_USER:?AJ_ROUTER_USER is required (set in .env)}"
: "${AJ_ROUTER_PASS:?AJ_ROUTER_PASS is required (set in .env)}"

# kill old instances
pkill -f 'cloudflared tunnel --url http://127.0.0.1:8088' || true
pkill -f 'cloudflared tunnel --url http://127.0.0.1:8080' || true
pkill -f 'ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -R 80:localhost:3000 nokey@localhost.run' || true
pkill -f '/home/ajserver/projects/aj-chat-app' || true
pkill -f '/home/ajserver/projects/aj-drive' || true
pkill -f '/home/ajserver/projects/project-router' || true
pkill -f '^node server.js$' || true

# start apps
nohup bash -lc 'cd /home/ajserver/projects/aj-chat-app && HOST=127.0.0.1 PORT=3000 npm start' > /tmp/aj-chat-app.log 2>&1 &
nohup bash -lc 'cd /home/ajserver/projects/aj-drive && HOST=127.0.0.1 PORT=3010 npm start' > /tmp/aj-drive.log 2>&1 &
nohup bash -lc "cd /home/ajserver/projects/project-router && ROUTER_HOST=127.0.0.1 ROUTER_PORT=8088 AJ_ROUTER_USER='${AJ_ROUTER_USER}' AJ_ROUTER_PASS='${AJ_ROUTER_PASS}' npm start" > /tmp/project-router.log 2>&1 &

# wait router then start tunnel
sleep 2
nohup /home/ajserver/.local/bin/cloudflared tunnel --url http://127.0.0.1:8088 > /tmp/cloudflared-router.log 2>&1 &

# optional status snapshot
sleep 2
ss -ltnp | egrep '127.0.0.1:(3000|3010|8088)' || true

# extract quick tunnel URL and notify via OpenClaw if available
URL=""
for _ in $(seq 1 15); do
  URL=$(grep -Eo 'https://[-a-z0-9]+\.trycloudflare\.com' /tmp/cloudflared-router.log | tail -n 1 || true)
  [[ -n "${URL:-}" ]] && break
  sleep 2
done
if [[ -n "${URL:-}" ]]; then
  echo "$URL" > /home/ajserver/projects/cloudflare-current-url.txt
  if command -v openclaw >/dev/null 2>&1; then
    openclaw system event --text "Cloudflare tunnel started: $URL" --mode now >/tmp/openclaw-notify.log 2>&1 || true
  fi
fi
