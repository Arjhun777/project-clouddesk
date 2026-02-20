# Project CloudDesk

Includes:
- `aj-chat-app` — chat/video/screen-share app
- `aj-drive` — external drive browser + secure uploads
- `project-router` — authenticated route launcher (`/chat`, `/drive`)
- `start-aj-services.sh` — startup script

## Security
Credentials are loaded from environment variables (not hardcoded):
- `AJ_ROUTER_USER`
- `AJ_ROUTER_PASS`

Setup:
1. `cp .env.example .env`
2. Edit `.env` with your credentials
3. Run startup script
