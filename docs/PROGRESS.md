# Build progress

Tracks the SPEC phases (`docs/SPEC.md §13`). Updated with each PR.

| Phase | Status | Notes |
|---|---|---|
| 0 Discovery + gap report | **Not started** | Needs the platform repo + DB inspection and Alex sign-off before any platform-integration code. |
| 1 Self-hosted LLM | Demo-ready (Ollama) | `LocalLlamaProvider` speaks OpenAI-compatible chat/embeddings to Ollama or llama-server, loopback-only. Verified against Ollama `qwen2.5:3b` + `nomic-embed-text`. VM llama.cpp path still unpinned/unbenchmarked. |
| 2 Knowledge layer + tools | Demo-ready | Markdown ingest (`npm run knowledge:reindex`), JSON-stored embeddings + in-process cosine retrieval (no pgvector needed), six read-only Zod tools; `get_my_registrations` is phone-scoped from the conversation. Program data is a local Sanad-owned mirror until Phase 0. Draft knowledge docs in `docs/knowledge/`. No eval harness yet. |
| 3 WhatsApp Q&A | Demo-ready | Twilio webhook + idempotency, 3-tier `route()`, Tier 1 fast path backed by real program data, Tier 2 retrieval-first tool-calling agent (45 s budget, escalates when ungrounded), all 5 escalation triggers, STOP opt-out, in-memory rate limiter (Valkey pending). Browser simulator drives the same pipeline without Twilio. |
| 4 Launch pipeline | Not started | Blocked on Phase 0 decision: platform service-token API vs. platform-side build. |
| 5 Comms dispatch | Not started | Meta template submission should start now (SPEC §14.3). |
| 6 Group handoff | Not started | Lockfile audit script exists (`npm run audit:whatsapp`) and runs in CI. |
| 7 Instagram publishing | Not started | |
| 8 Admin console | Minimal | Basic-auth (`SANAD_ADMIN_PASSWORD`) conversations list/detail, escalation queue, takeover / hand-back, programs view, simulator. Real user accounts (`AdminUser`) not wired. |
| 3b Instagram DM parity | Not started | Inbound shape is already channel-neutral (`NormalisedInbound`). |

## Open decisions (from SPEC §14)

1. Knowledge seed text
2. Twilio WhatsApp sender status (sandbox vs approved)
3. Meta template submission — start now
4. Escalation destination number(s) → `SANAD_ADMIN_WHATSAPP`
5. Latency tolerance (3B vs 7B vs hosted)
6. Instagram DM scope
7. Platform write path (service-token API vs platform-side build)
8. `sanad_ro` / `sanad_rw` Postgres roles on the Supabase project
