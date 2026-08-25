# Dayani Meeting — Self-hosted WebRTC V1

## Goal
A private 1:1 Dayani Group video call with no Zoom, Google Meet or Jitsi dependency.

## Runtime
- Browser WebRTC for direct encrypted media
- Node.js + WebSocket signaling (`server.js`)
- Self-hosted coturn for STUN/TURN reliability across mobile carriers, NAT and corporate networks
- HTTPS/WSS required in production for camera/microphone access

## Domains
Recommended split:
- `meet.dayanigroup.com` → Node app / reverse proxy
- `turn.dayanigroup.com` → coturn server public IP

## Required DNS
- `meet` → A/AAAA record to the application server or reverse-proxy target
- `turn` → A/AAAA record directly to the coturn public IP

GitHub Pages cannot host this version because signaling requires a persistent WebSocket server.

## Environment
Copy `.env.example` to `.env` on the server and set:
- `PORT`
- `STUN_URL`
- `TURN_URL`
- `TURN_USERNAME`
- `TURN_PASSWORD`

Never commit `.env` or production TURN credentials.

## App behavior
- Host creates a room and receives a guest link.
- Guest opens the link on mobile or desktop and requests entry.
- Host sees the guest name and allows or denies entry.
- After approval, the two browsers establish a peer-to-peer WebRTC call.
- Microphone, camera and end-call controls are available.
- The host sees their own camera in a small self-view over the main remote video.
- Rooms are limited to host + one guest.

## Production requirements
1. A server capable of running Node.js 20+ continuously.
2. HTTPS certificate for `meet.dayanigroup.com` (Caddy or Nginx + Let's Encrypt is sufficient).
3. coturn installed on a public server/IP for `turn.dayanigroup.com`.
4. Open TURN ports: UDP/TCP 3478 and a configured UDP relay range.
5. Reverse proxy WebSocket upgrade support for `/signal`.
6. Test matrix: Mac Safari/Chrome ↔ iPhone Safari, Mac ↔ Android Chrome, mobile ↔ mobile, Wi-Fi ↔ cellular.

## Next phase (not part of V1)
Live Persian/English translation, subtitles and Smart Reply are intentionally excluded until the base video call is stable.
