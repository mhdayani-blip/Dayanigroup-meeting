# Dayani Group Meeting Platform

پلتفرم تماس و جلسه حرفه‌ای گروه دیانی — Professional meeting and video-call platform.

## Product direction

- International video meetings with a refined Dayani interface
- Live translation support
- Private real-time AI analysis panel for the owner
- Compact self-view beneath the assistant panel
- Matte-glass design language shared with other Dayani products

## Current status

The first static meeting interface is deployed with GitHub Pages. Jitsi provides the
current browser-based meeting experience. Palabra translation is intentionally kept
as the next isolated integration step so the current interface and meeting flow stay
simple and unchanged.

## Deployment

The site is deployed by `.github/workflows/pages.yml` whenever `main` is updated.
The workflow uploads the repository as a static Pages artifact and deploys it with
GitHub's official Pages actions.

GitHub repository settings:

1. Open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Set **Custom domain** to `meet.dayanigroup.com`.
4. After DNS validation succeeds, enable **Enforce HTTPS**.

DNS record:

| Type | Host / Name | Value / Target | TTL |
| --- | --- | --- | --- |
| CNAME | `meet` | `mhdayani-blip.github.io` | Automatic or 3600 |

Do not add `https://`, a path, or a trailing dot unless the DNS provider adds it
automatically. Remove any conflicting A, AAAA, or CNAME record for the `meet`
hostname. If the DNS provider offers proxying, keep this record DNS-only until
GitHub validates the custom domain and provisions HTTPS.

The repository-root `CNAME` file must contain exactly:

```text
meet.dayanigroup.com
```

## Palabra integration boundary

Add Palabra later behind a small translation adapter or service module. Keep
credentials and token creation server-side, and let the existing translation panel
consume only translated text and connection state. Do not place Palabra secrets in
this static repository or couple the translation transport to the Jitsi UI.

## Working rules

- Never commit credentials, meeting recordings or personal conversation data.
- Changes should be made on a feature branch and reviewed before merging to `main`.
- Privacy-sensitive features require an explicit architecture decision record.
