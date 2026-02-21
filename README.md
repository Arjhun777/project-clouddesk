# Project CloudDesk (Raspberry Pi + OpenClaw)

A self-hosted project stack controlled from Telegram via OpenClaw.

## What’s inside

- `aj-chat-app` — realtime chat + video call + screen share
- `aj-drive` — external-drive browser + secure multi-file uploads (image/video)
- `project-router` — auth-protected launcher and route proxy (`/chat`, `/drive`)
- `start-aj-services.sh` — starts app services + quick Cloudflare tunnel

---

## 1) Prerequisites

- Raspberry Pi / Ubuntu/Debian-like Linux
- Node.js + npm
- OpenClaw installed and configured
- Telegram integration paired in OpenClaw
- `cloudflared` binary at:
  `/home/ajserver/.local/bin/cloudflared`

---

## 2) Clone and install

```bash
cd /home/ajserver/projects
git clone https://github.com/Arjhun777/project-clouddesk.git
cd project-clouddesk
```

Install dependencies:

```bash
cd /home/ajserver/projects/project-clouddesk/aj-chat-app && npm install
cd /home/ajserver/projects/project-clouddesk/aj-drive && npm install
cd /home/ajserver/projects/project-clouddesk/project-router && npm install
```

---

## 3) Configure secrets (required)

```bash
cd /home/ajserver/projects/project-clouddesk
cp .env.example .env
nano .env
```

Set values:

```env
AJ_ROUTER_USER=your_user
AJ_ROUTER_PASS=your_strong_password
```

---

## 4) Start OpenClaw gateway

Use OpenClaw CLI:

```bash
openclaw gateway status
openclaw gateway start
```

(Use `openclaw gateway restart` after config changes.)

---

## 5) Run the project stack manually

```bash
/home/ajserver/projects/project-clouddesk/start-aj-services.sh
```

This script:
- starts `aj-chat-app` on `127.0.0.1:3000`
- starts `aj-drive` on `127.0.0.1:3010`
- starts `project-router` on `127.0.0.1:8088`
- starts Cloudflare quick tunnel to router
- writes current tunnel URL to:
  `/home/ajserver/projects/cloudflare-current-url.txt`

---

## 6) Enable auto-start on reboot

Add startup script to crontab:

```bash
(crontab -l 2>/dev/null; echo '@reboot /home/ajserver/projects/project-clouddesk/start-aj-services.sh') | crontab -
```

Verify:

```bash
crontab -l
```

---

## 7) Access routes

After startup, read current public URL:

```bash
cat /home/ajserver/projects/cloudflare-current-url.txt
```

Then use:
- `<URL>/chat/`
- `<URL>/drive/`

Router root (`<URL>/`) shows project launcher UI.

---

## 8) Logs / troubleshooting

```bash
tail -f /tmp/aj-chat-app.log
tail -f /tmp/aj-drive.log
tail -f /tmp/project-router.log
tail -f /tmp/cloudflared-router.log
```

Port check:

```bash
ss -ltnp | egrep '127.0.0.1:(3000|3010|8088)'
```

---

## Notes

- Cloudflare **quick tunnel** (`trycloudflare.com`) is temporary; URL can change after restart.
- For a fixed URL, use a **named Cloudflare tunnel + custom domain**.
