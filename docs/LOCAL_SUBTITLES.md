# Local bilingual subtitles

## Scope

This layer adds only translated subtitles to the existing private 1:1 Dayani WebRTC call.

- Host (Mohammad) speaks Persian -> guest sees English subtitle.
- Guest speaks English -> host sees Persian subtitle.
- Original speech text is not shown.
- No translated audio is generated.
- No external translation API, billing account, credit card or API key is required.

## Local pipeline

Each participant processes only their own microphone stream:

1. Browser downsamples local microphone audio to 16 kHz mono PCM.
2. Browser sends PCM frames to `/translate/ws`.
3. Faster-Whisper converts speech to source-language text.
4. MADLAD-400 CTranslate2 translates the text to the other participant's language.
5. The translated text returns to the speaker's browser.
6. The existing Dayani signaling WebSocket relays only the translated caption to the other participant.
7. The other participant sees one subtitle overlay.

This avoids processing the remote audio twice and keeps the UI minimal.

## Models

- Speech recognition: `faster-whisper`, default model `small`.
- Translation: `santhosh/madlad400-3b-ct2`, a CTranslate2 conversion of MADLAD-400.
- Translation target tags: `fa` and `en`.

Model files are public and downloaded on the server during first use. No Hugging Face account/token is required for these public files.

## Deployment

The simplest deployment is one Linux VPS with Docker Compose:

```bash
cp .env.selfhosted.example .env
# Edit TURN_PASSWORD before production.
docker compose -f docker-compose.selfhosted.yml up -d --build
```

Required DNS records, both pointing to the VPS public IP:

- `meet.dayanigroup.com` -> A record
- `turn.dayanigroup.com` -> A record

Open firewall ports:

- TCP 80
- TCP 443
- UDP 443
- TCP/UDP 3478
- UDP 49160-49200

Caddy automatically serves HTTPS for `meet.dayanigroup.com`. coturn provides self-hosted STUN/TURN.

## Performance note

The default configuration uses CPU-safe settings and favors easy installation. Real subtitle latency must be measured on the actual VPS. If CPU latency is too high, first try a faster Whisper model (`base` or `tiny`) or move only the translation service to a GPU-capable VPS. The browser/UI does not need to change.
