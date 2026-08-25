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
Copy `.env.selfhosted.example` to `.env` on the server and set:
- `TURN_SHARED_SECRET` — long random coturn TURN-REST shared secret
- `PUBLIC_IP` — the VPS public IPv4 address
- `MODEL_DEVICE`, `WHISPER_MODEL`, `TRANSLATION_MODEL` and
  `TRANSLATION_CHUNK_SECONDS` only after the subtitle benchmark

The Node service derives short-lived TURN credentials from `TURN_SHARED_SECRET`.
It never sends the long-lived coturn secret to a browser. Never commit `.env`,
the shared secret, server credentials or TLS keys.

## App behavior
- Host creates a room and receives a guest link.
- The server issues a random host-only capability token; a guest cannot become
  host merely by changing `role=guest` in the URL.
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
The translated subtitle sidecar is included only on the local-subtitles branch.
Smart Reply, transcript history, AI assistant and translated voice remain out of
scope.
