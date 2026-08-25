# Architecture and Product Decisions

Use this log for decisions that affect product behavior, security, data, integrations or the shared Dayani design system.

## Decision template

### YYYY-MM-DD — Decision title

- **Status:** Proposed / Approved / Superseded
- **Context:** Why the decision is needed
- **Decision:** What was selected
- **Consequences:** Benefits, limitations and follow-up work
- **Owner:** Responsible person

---

### 2026-08-08 — Simple browser-first meeting MVP

- **Status:** Superseded
- **Context:** Jitsi was used only as a temporary path to get a browser video call running quickly.
- **Decision:** Replace Jitsi with the self-hosted WebRTC architecture below.
- **Consequences:** Existing Jitsi code remains only on `main` until the self-hosted server is deployed and verified.
- **Owner:** Dayani Group

### 2026-08-25 — Dayani-owned 1:1 WebRTC core

- **Status:** Approved
- **Context:** Dayani Group needs a very light private video meeting that works from Mac or mobile without Zoom, Google Meet, Jitsi or translation features.
- **Decision:** Use direct browser WebRTC media, a Dayani-owned Node/WebSocket signaling server, host approval for one guest, and self-hosted coturn for NAT traversal. Keep the approved dark Dayani call UI and exclude translation/AI from V1.
- **Consequences:** `meet.dayanigroup.com` must run on infrastructure that supports a persistent Node/WebSocket process; GitHub Pages alone is insufficient. A public TURN server under Dayani control is required for reliable internet/mobile connectivity.
- **Owner:** Dayani Group
