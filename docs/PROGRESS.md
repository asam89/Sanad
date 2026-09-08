# Build progress

Tracks the SPEC phases (`docs/SPEC.md §13`). Updated with each PR.

| Phase | Status | Notes |
|---|---|---|
| 0 Discovery + gap report | **Not started** | Needs the platform repo + DB inspection and Alex sign-off before any platform-integration code. |
| 1 Self-hosted LLM | Scaffolded | `LLMProvider` + `LocalLlamaProvider` + `MockProvider` with tests. systemd units, build/download scripts, `docs/llm-setup.md`. **Not yet run on the VM**: commit unpinned, benchmarks pending. |
| 2 Knowledge layer + tools | Schema only | `KnowledgeDoc` / `KnowledgeChunk` in `prisma/schema.prisma`. No ingest, no tools, no eval harness yet. |
| 3 WhatsApp Q&A | Gateway shell | Twilio webhook with signature validation + idempotency, 3-tier `route()`, Tier 1 fast path (static answers until Phase 2 tools exist), all 5 escalation triggers, STOP opt-out, rate limiter (in-memory; Valkey pending), redacted structured logs. **No AI path yet** (unrouted questions escalate). |
| 4 Launch pipeline | Not started | Blocked on Phase 0 decision: platform service-token API vs. platform-side build. |
| 5 Comms dispatch | Not started | Meta template submission should start now (SPEC §14.3). |
| 6 Group handoff | Not started | Lockfile audit script exists (`npm run audit:whatsapp`) and runs in CI. |
| 7 Instagram publishing | Not started | |
| 8 Admin console | Not started | `AdminUser` model exists. |
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
