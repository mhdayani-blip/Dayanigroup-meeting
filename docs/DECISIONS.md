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

- **Status:** Approved
- **Context:** The first release must be easy to open from Mac or mobile and should avoid unnecessary infrastructure before translation credentials are available.
- **Decision:** Use a minimal Dayani web shell with Jitsi Meet as the temporary video transport. Keep the translation panel separate so Palabra and the Persian translation path can be added without replacing the UI.
- **Consequences:** The first release can provide a real browser video call without a custom signaling backend. Palabra live translation, Smart Reply, private AI processing, and final self-hosted WebRTC/LiveKit transport remain the next integration steps. No API credentials are stored client-side.
- **Owner:** Dayani Group
