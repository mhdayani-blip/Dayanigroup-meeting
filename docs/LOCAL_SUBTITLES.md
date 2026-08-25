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

Model files are public and downloaded when the translation container starts, not
when the first caller speaks. No Hugging Face account/token is required for the
current MADLAD baseline. The service does not accept calls until both models are
loaded, so Caddy may briefly report the translation endpoint unavailable after a
cold deployment.

The translation worker allows only one chunk in flight per participant. When a
CPU-bound chunk is still processing, the next stale chunk is dropped instead of
forming a delayed transcript queue. This is intentional: subtitle freshness is
more useful than recovering every word for this product.

## Deployment

The simplest deployment is one Linux VPS with Docker Compose:

```bash
cp .env.selfhosted.example .env
# Set TURN_SHARED_SECRET and the VPS PUBLIC_IP before production.
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

Before choosing the production translation model, run the benchmark on the
target VPS with real Persian and English conversational samples. Compare the
current MADLAD CTranslate2 baseline with NLLB-200 distilled 600M (personal-use
candidate), Faster-Whisper `base` and `small`, and 1.5 s, 2.0 s and 3.0 s chunks.
Record end-to-end caption latency, RSS memory, CPU and human-understandable
translation quality. Do not claim a final model choice from a local build alone.

## Performance note

The default configuration uses CPU-safe settings and favors easy installation. Real subtitle latency must be measured on the actual VPS. If CPU latency is too high, first try a faster Whisper model (`base` or `tiny`) or move only the translation service to a GPU-capable VPS. The browser/UI does not need to change.
