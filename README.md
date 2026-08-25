# Dayani Group Meeting Platform

پلتفرم تماس و جلسه حرفه‌ای گروه دیانی — Professional meeting and video-call platform.

## Product direction

- Private browser-first 1:1 video calls with native WebRTC
- Host approval before a guest enters; maximum two participants
- Dayani dark graphite / yellow matte-glass UI, preserved without dashboards or chat
- Minimal translated subtitles only: Persian → English for the guest, English → Persian for Mohammad
- No Zoom, Google Meet, Jitsi, paid translation API, recordings or transcript history

## Production architecture

`meet.dayanigroup.com` is intended to run on one Ubuntu VPS through Docker Compose:

1. Node.js meeting app and WebSocket signaling
2. Python Faster-Whisper + local translation sidecar
3. coturn with short-lived TURN-REST credentials
4. Caddy reverse proxy with automatic HTTPS

GitHub Pages is only a temporary legacy deployment and cannot run this architecture.
Keep its DNS record unchanged until the VPS is deployed and verified; at cutover,
replace only the `meet` record with an A record pointing at the VPS and disable the
Pages workflow/custom-domain configuration. Do not modify the main website records.

## Deploy on the VPS

```bash
cp .env.selfhosted.example .env
# Set TURN_SHARED_SECRET and PUBLIC_IP in .env.
docker compose -f docker-compose.selfhosted.yml up -d --build
docker compose -f docker-compose.selfhosted.yml logs -f translation
```

Required firewall ports: TCP 80/443, TCP+UDP 3478, and TCP+UDP 49160-49200. The
translation container downloads and loads its model before it accepts calls.

## Model decision

Do not select a final subtitle model from code review. Benchmark Faster-Whisper
`base` and `small`, and NLLB-200 distilled 600M against the MADLAD baseline on the
actual VPS. See `docs/LOCAL_SUBTITLES.md` for the acceptance measurements.

## Working rules

- Never commit credentials, meeting recordings or personal conversation data.
- Changes should be made on a feature branch and reviewed before merging to `main`.
- Privacy-sensitive features require an explicit architecture decision record.
