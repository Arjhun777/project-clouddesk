# AJ Chat App

Basic direct-message chat web app using **Node.js + Express + Socket.IO**.

## Features
- Ask for username on first load
- Shows online users
- Select user and send direct messages
- Conversation thread per user pair
- In-memory storage (no database)

## Run
```bash
cd /home/ajserver/projects/aj-chat-app
npm install
npm start
```

Server binds to:
- `HOST` env var (default `0.0.0.0`)
- `PORT` env var (default `3000`)

## Access from phone (same Wi-Fi/LAN)
1. Find server IP (example: `192.168.1.50`)
2. Open in phone browser: `http://192.168.1.50:3000`
3. Ensure firewall allows TCP 3000.

## Notes
- Data resets when server restarts.
- Duplicate usernames are blocked while online.

## Video call note
- Browser camera/mic needs **secure context (HTTPS)** on phones.
- Use the public tunnel URL for video calls (not plain http LAN URL).
