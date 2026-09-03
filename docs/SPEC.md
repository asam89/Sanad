# Devin Spec: Sanad — FaezSports WhatsApp Assistant & Program Launch Pipeline

**Owner:** Alex Sam
**Target repo:** `github.com/asam89/Sanad` (standalone service; reads FaezSports data from `github.com/asam89/faezsports-platform`'s database via a read-only role)
**Target host:** OCI Ampere VM (`140.238.131.77` / Tailscale `100.66.138.10`), Ubuntu 24.04, 4 OCPU / 24 GB
**Staging:** `dev.faezsports.com:3001` (platform) / `sanad-dev.faezsports.com` → port `3101` (Sanad)
**Production:** `sanad.faezsports.com` → port `3100`
**Status:** In implementation — see `docs/PROGRESS.md`

---

## 0. What this is

**Sanad** (سند, "support" / "the one you lean on") is a WhatsApp-first assistant for FaezSports. It does two things:

1. **Answers questions** sent to the FaezSports WhatsApp number by parents, players, and prospects — grounded on real data from `leagues.faezsports.com`, not on guesses.
2. **Runs the program launch pipeline** — product creation, registration tracking, roster export, comms dispatch, WhatsApp group handoff, and Instagram publishing.

All LLM inference runs on a **self-hosted model compiled and served on the OCI VM**. No conversation content, roster data, or parent PII leaves the VM for inference.

### 0.1 Why a separate repo

Sanad lives in its own repository and runs as its own process on the same VM as the platform. Reasons:

- The platform (`faezsports-platform`) is a Vercel-shaped Next.js app; Sanad is a long-running, VM-bound service that owns webhooks, background queues, and local inference. Different deploy cadence, different failure modes.
- The platform's stat engine and SSE paths are frozen (§1). A separate repo makes it structurally impossible for Sanad work to touch them.
- Sanad's database role is read-only against platform tables. Owning that boundary at the repo level keeps "the LLM never writes" enforceable.

What this means in practice:

- **Two Prisma schemas.** `prisma/schema.prisma` owns Sanad's tables (`Conversation`, `Message`, `KnowledgeDoc`, `KnowledgeChunk`, `Campaign`, `ProgramGroup`, …) in a dedicated `sanad` Postgres schema. `prisma/platform.prisma` is an **introspected, read-only** mirror of the platform tables Sanad needs (`League`, `Team`, `Game`, `Roster`, `User`, and whatever §2 discovery finds for programs/registrations/venues). It is regenerated with `prisma db pull` and never migrated from this repo.
- **Platform mutations go through the platform.** Where a pipeline step must write platform data (create program + `Schedule` rows, ingest registrations), Sanad calls the platform's admin API with a service token, or the feature is built in the platform repo and Sanad only reads the outcome. §2.4's gap report decides per requirement.
- **Same Twilio number, same Instagram account.** Sanad owns the Twilio webhook; the platform must not also register one.

---

## 1. Hard guards — do not violate

These are non-negotiable. If a requirement below appears to conflict with one of these, stop and raise it rather than working around it.

- **No unofficial WhatsApp automation.** No `whatsapp-web.js`, `Baileys`, Puppeteer-driven WhatsApp Web, or any library that authenticates as a user session. Twilio's WhatsApp Business API is the only permitted transport. Group creation and group membership editing are **out of scope for automation** (see §8).
- **No Supabase Realtime.** SSE only, matching existing platform convention.
- **No forked payments path.** Do not create a second Stripe integration, second webhook handler, or parallel order model. Reuse what exists.
- **No changes to the stat engine or SSE box-score paths.** Read from them if needed; do not modify.
- **The LLM never writes to the database.** All model-facing tools are read-only. Every mutation (create product, send broadcast, publish post) is an explicit admin-confirmed action through the admin UI or an admin WhatsApp confirmation, never something the model can trigger on its own.
- **No PII to third-party APIs.** Rosters, phone numbers, parent names, and child names must not be sent to any external inference or automation service. This is the reason for self-hosted inference.
- **Staging first.** Every migration runs on `dev.faezsports.com` and is verified before production.
- **Devin owns branches exclusively.** No concurrent Claude Code sessions on this repo while this spec is in flight.
- **Sanad never migrates platform tables.** `prisma/platform.prisma` is introspection-only. Platform schema changes go through the platform repo.

---

## 2. Step 0 — Mandatory discovery

**Do not write platform-integration code until this is complete and reported back.** Repo scaffolding, the LLM provider abstraction (§4.4), the Twilio gateway shell (§6.1), and the fast-path router (§6.2 Tier 1) do not depend on platform data and may be built in parallel with discovery.

Inspect the actual current state of the platform repo and database and produce a short written findings document covering:

**2.1 Schema inventory**
- Dump the current `schema.prisma` in full.
- Confirm the exact shape of `Schedule`, `PlayerStat`, `StatDefinition`, `MatchScore`.
- Identify every existing model that represents: a program/league/session offering, a registration or order, a player, a parent/guardian, a team, a venue, a payment.
- Report which of these already exist and which are genuinely missing. **Extend existing models; do not create parallel duplicates.**

**2.2 Integration inventory**
- Locate the existing Stripe integration (webhook handler, product/price handling, order model).
- Locate the existing Hostinger CSV order import path.
- Locate the existing Instagram publishing tool on the VM and document its interface (script path, invocation, required env vars, how it exposes media over HTTPS).
- Locate any existing email sending (Resend or otherwise) and any existing Twilio usage.

**2.3 Runtime inventory**
- Document the systemd unit(s) currently running the platform, the Node version, the reverse proxy config (Nginx and/or Caddy), and how staging is isolated.
- Report available disk, RAM headroom, and CPU idle on the VM.
- Confirm whether `pgvector` is available on the Supabase project.

**2.4 Gap report**
Produce a table: `Requirement | Already exists (where) | Must be built`. Get sign-off on this table before Phase 1.

---

## 3. Architecture

```
                    Parent / player on WhatsApp
                              │
                       Twilio WhatsApp API
                              │  (webhook, HTTPS)
                              ▼
   ┌──────────────────────────────────────────────────┐
   │  sanad-gateway  (Next.js API routes, this repo)   │
   │   · signature validation                          │
   │   · rate limiting                                 │
   │   · conversation state (Postgres + Valkey)        │
   └────────────┬─────────────────────┬────────────────┘
                │                     │
        fast path (deterministic)     │ AI path
                │                     ▼
                │        ┌────────────────────────────┐
                │        │  sanad-agent                │
                │        │   · retrieval (pgvector)    │
                │        │   · tool calling            │
                │        │   · confidence scoring      │
                │        └──────┬──────────────┬───────┘
                │               │              │
                │               ▼              ▼
                │      ┌─────────────┐  ┌──────────────────┐
                │      │ llama-server│  │ Read-only tools  │
                │      │ (localhost) │  │ (Prisma, RO role │
                │      │ self-hosted │  │  on platform DB) │
                │      └─────────────┘  └──────────────────┘
                │
                └──────────► reply via Twilio
                                  │
                       low confidence / escalation
                                  ▼
                        Admin WhatsApp + admin UI
```

Separately, the **launch pipeline** (§7–§10) is admin-triggered from Sanad's admin UI and shares the same data layer and the same Twilio/Instagram outbound services. Steps that mutate platform data call the platform's admin API (§0.1).

**Runtime layout on the VM:**

| Unit | Binds | Purpose |
|---|---|---|
| `faezsports.service` | `127.0.0.1:3000` (existing) | Platform |
| `sanad.service` | `127.0.0.1:3100` | Sanad app (Next.js, `npm start`) |
| `sanad-worker.service` | — | Background queue: AI-path replies, dispatch, re-index |
| `sanad-llm-chat.service` | `127.0.0.1:8081` | 3B chat model |
| `sanad-llm-batch.service` | `127.0.0.1:8082` | 7B batch model (on demand) |
| `sanad-llm-embed.service` | `127.0.0.1:8083` | Embedding model |
| Valkey | `127.0.0.1:6379` | Rate limits, 24h-window state, queue |

Nginx terminates TLS for `sanad.faezsports.com` and proxies to `3100`. Unit files live in `deploy/systemd/`.

---

## 4. Phase 1 — Self-hosted LLM inference service

### 4.1 Build

Compile `llama.cpp` from source on the VM. It is ARM64 (Neoverse N1, Armv8.2-A, has `dotprod`, **no** `i8mm`, **no** SVE) — build natively, do not fetch an x86 binary.

```bash
sudo apt update && sudo apt install -y build-essential cmake git libcurl4-openssl-dev
git clone https://github.com/ggml-org/llama.cpp /opt/llama.cpp
cd /opt/llama.cpp
cmake -B build -DGGML_NATIVE=ON -DLLAMA_CURL=ON
cmake --build build --config Release -j4
```

Pin to a specific upstream commit and record it in the repo. Do not track `master`.

### 4.2 Model selection

**Primary (conversational path): `Qwen2.5-3B-Instruct`, Q4_K_M GGUF.**
Rationale: this VM has no GPU. On 4 Ampere cores a 7B Q4 model realistically produces roughly 5–9 tokens/sec, which means a 150-token answer takes 20–30 seconds — too slow for a chat experience. A 3B at Q4 roughly doubles that. Reply latency is the single biggest UX risk in this build.

**Secondary (batch/offline path): `Qwen2.5-7B-Instruct`, Q4_K_M GGUF.**
Used for non-interactive work where latency doesn't matter: Instagram caption generation, broadcast copy drafting, weekly digest summarisation.

Qwen2.5 is chosen over Llama 3.1 specifically for its stronger structured function-calling behaviour, which this design depends on.

Store models in `/opt/models/`. Do not commit GGUF files to the repo.

### 4.3 Serving

Run `llama-server` as a systemd unit bound to **`127.0.0.1` only**. It exposes an OpenAI-compatible `/v1/chat/completions` endpoint.

Two units:
- `sanad-llm-chat.service` — 3B model, port `8081`, `--ctx-size 8192 --threads 3 --parallel 2`
- `sanad-llm-batch.service` — 7B model, port `8082`, `--ctx-size 8192 --threads 4`, started on demand rather than always-on if RAM or CPU contention becomes an issue

Also run an embedding server for retrieval:
- `sanad-llm-embed.service` — `bge-small-en-v1.5` GGUF, port `8083`, `--embedding`

**Never bind any of these to `0.0.0.0`.** Same rule as PostgreSQL on this host.

### 4.4 Provider abstraction

Build a single `LLMProvider` interface in the app (`src/lib/llm/provider.ts`) with `chat()`, `chatWithTools()`, and `embed()`. Implement `LocalLlamaProvider` against the OpenAI-compatible endpoints. Because the interface is OpenAI-shaped, a hosted provider can be swapped in later by config alone. Selection via `LLM_PROVIDER` env var.

### 4.5 Acceptance criteria — Phase 1

- [ ] `llama.cpp` builds cleanly on the VM at a pinned commit; build steps documented in `docs/llm-setup.md`
- [ ] All three systemd units run, auto-restart on failure, and bind only to `127.0.0.1`
- [ ] `curl` against each endpoint from the VM returns a valid completion / embedding
- [ ] `curl` against each endpoint from outside the VM is refused
- [ ] Benchmark recorded in `docs/llm-setup.md`: tokens/sec and p50/p95 time-to-first-token and total-response for a representative 120-token answer, for both models
- [ ] `LLMProvider` interface exists with a passing unit test using a mock provider

---

## 5. Phase 2 — Knowledge layer and read-only tools

The model must answer from real data. Two mechanisms.

### 5.1 Retrieval (for policy/prose questions)

New models:

```prisma
model KnowledgeDoc {
  id          String   @id @default(cuid())
  slug        String   @unique
  title       String
  category    String   // "policy" | "faq" | "program" | "rules" | "venue"
  body        String   @db.Text
  isPublished Boolean  @default(false)
  updatedAt   DateTime @updatedAt
  chunks      KnowledgeChunk[]
}

model KnowledgeChunk {
  id        String   @id @default(cuid())
  docId     String
  doc       KnowledgeDoc @relation(fields: [docId], references: [id], onDelete: Cascade)
  ordinal   Int
  content   String   @db.Text
  embedding Unsupported("vector(384)")?
  @@index([docId])
}
```

These live in Sanad's own `sanad` schema. Enable `pgvector` on staging first. If unavailable on the Supabase plan, fall back to Postgres full-text search (`tsvector` + `pg_trgm`) — the corpus is small enough (low hundreds of chunks) that lexical retrieval is acceptable. Report which path was taken.

Seed content (Alex supplies the text; you build the ingest):
- Refund and withdrawal policy
- Code of conduct
- Makeup / cancellation policy for weather and holidays
- Tournament rules, including FIBA specifics used for the 35+ tournament (gather step, pivot foot, traveling)
- Venue info: address, parking, entrances, gym access rules
- Sponsorship tiers and what each includes
- "How registration works" — Hostinger checkout to platform roster

Ingest pipeline: chunk at ~400 tokens with 50-token overlap, embed via the embedding server, store. Re-embed on doc update. Provide a CLI: `npm run knowledge:reindex`.

### 5.2 Read-only data tools (for factual questions)

Expose these to the model as tool definitions. Each is a thin, parameter-validated (Zod) Prisma read. **No tool may write.** Every tool must scope results to the requesting phone number's own household where the data is personal.

| Tool | Purpose |
|---|---|
| `list_open_programs` | Programs currently open for registration, with price, ages, day/time, venue, start date, and registration URL |
| `get_program_details(programId)` | Full detail for one program, including session dates |
| `get_schedule(programId, from, to)` | Upcoming sessions/games from the existing `Schedule` model |
| `get_next_session(programId)` | The single next session, with date, time, venue |
| `lookup_my_registrations(phone)` | Registrations tied to the requesting number. Returns child first name, program, status, and payment status only |
| `get_venue(venueId)` | Address, parking, access notes |
| `search_knowledge(query)` | Retrieval over `KnowledgeChunk` |
| `get_standings(programId)` | Read from existing standings/`MatchScore` derivation. Read-only |

**Privacy rule:** `lookup_my_registrations` matches on the inbound WhatsApp number only. There is no tool that lets the model look up an arbitrary person by name. If someone asks about a child not linked to their number, the bot declines and offers admin escalation.

### 5.3 Acceptance criteria — Phase 2

- [ ] Migration applied on staging, then production; existing models extended rather than duplicated
- [ ] `npm run knowledge:reindex` ingests seed docs and populates chunks + embeddings
- [ ] Every tool has a Zod schema, a unit test, and a test proving it cannot return another household's data
- [ ] A test harness (`npm run sanad:eval`) runs a fixture set of ~30 real questions against the tool layer and reports pass/fail

---

## 6. Phase 3 — WhatsApp Q&A (the core feature)

### 6.1 Transport

Twilio WhatsApp Business API. Inbound webhook at `POST /api/sanad/whatsapp/inbound`.

Requirements:
- Validate `X-Twilio-Signature` on every request. Reject unsigned/invalid immediately.
- Respond `200` within Twilio's timeout; do all real work asynchronously and send the reply as a separate outbound message.
- Per-number rate limit (Valkey): 20 messages / 5 min, then a polite throttle message.
- Store every inbound and outbound message in a `Conversation` / `Message` model for audit and for the admin console.

### 6.2 Routing

Three-tier, in order:

**Tier 1 — Deterministic fast path.** Keyword and regex matching for the highest-volume intents: `register`, `schedule`, `cost`/`price`, `location`/`address`, `refund`, `pay`. These return templated answers assembled directly from tool output with **no LLM call**. This keeps the most common questions near-instant and takes load off the model. Target: this tier handles the majority of traffic.

**Tier 2 — AI path.** Everything else. The agent loop:
1. Retrieve relevant knowledge chunks
2. Call the model with the system prompt, retrieved context, conversation history (last 6 turns), and tool definitions
3. Execute any requested read-only tools, feed results back, allow up to 3 tool-calling rounds
4. Produce the answer

**Tier 3 — Escalation.** Hand off to a human when any of these fire:
- The model's answer contains no tool-grounded fact and the question was factual
- Retrieval returned nothing above the similarity floor
- Explicit keywords: `refund`, `complaint`, `injury`, `injured`, `hurt`, `emergency`, `speak to someone`, `human`
- The user asks the same question twice in a row (an implicit signal the answer missed)
- Any tool error

On escalation: reply to the user acknowledging a human will follow up, and notify the admin WhatsApp number with the conversation excerpt and a deep link to the admin console.

### 6.3 System prompt requirements

The system prompt must instruct the model to:
- Speak as Sanad, the FaezSports assistant — warm, brief, WhatsApp-appropriate. Short paragraphs, no walls of text.
- **Never invent** a date, price, venue, or policy. If it isn't in tool output or retrieved context, say so and offer to connect a human.
- Never state or confirm a child's full name, address, or payment details.
- Use single dashes or colons, never double hyphens.
- Keep replies under roughly 600 characters unless listing session dates.

### 6.4 Latency handling

Because self-hosted inference on this hardware is slow:
- Send a Twilio "typing"-equivalent acknowledgement only if the AI path is taken and the first token hasn't arrived within 3 seconds. Do **not** send it on the fast path.
- Hard timeout at 45 seconds → escalate to human.
- Log time-to-first-token and total latency on every AI-path message.

### 6.5 Instagram DM parity (secondary channel)

Instagram DMs route into the **same agent core** via the Instagram Messaging API on the existing `@faezsports` Business account. The gateway normalises inbound messages from either channel into one internal shape so there is one agent, one tool layer, one escalation path.

Include comment-to-DM handling: when a user comments a configured keyword (default `LINK`) on a FaezSports post, reply publicly once and send the registration link by DM.

**Build this after §6.1–6.4 are working and verified on WhatsApp.** Do not build both channels in parallel.

### 6.6 Acceptance criteria — Phase 3

- [ ] Inbound Twilio webhook validates signature, is idempotent on retry, and returns 200 fast
- [ ] Fast path answers the 6 configured intents with no LLM call, in under 2 seconds end-to-end
- [ ] AI path answers correctly on the `sanad:eval` fixture set with no fabricated facts
- [ ] A number with no registrations cannot retrieve any household data
- [ ] All 5 escalation triggers verified with tests
- [ ] Every message persisted and visible in the admin console
- [ ] Instagram DM path uses the identical agent core (proven by a shared code path, not a copy)

---

## 7. Phase 4 — Program launch: product creation and registration tracking

Covers the pipeline steps: **create product → track registrations → compile roster.**

Permits and gym booking remain **manual human tasks**. The platform only records the outcome.

### 7.1 Launch wizard

Admin UI at `/admin/programs/new` in Sanad. Fields: name, ages, day/time, venue, start date, session count, price, capacity, registration URL. On submit it creates the program record and the associated `Schedule` rows, skipping Ontario statutory holidays and any admin-specified blackout dates.

If a Launch Wizard already exists in the platform from the prior spec (`devin-spec-league-launch-lifecycle.md`), Sanad's page **links to it or calls its API** — do not build a second one. Program and `Schedule` rows are platform data and are written via the platform admin API, never directly by Sanad.

### 7.2 Registration ingestion

Hostinger remains the storefront and source of truth for orders. Two ingest paths, both landing in the same normalised registration record:

1. **CSV import** (primary, existing pattern) — admin uploads the Hostinger order export; the importer maps orders to programs and creates/updates registrations. Must be idempotent: re-importing the same file changes nothing.
2. **Stripe webhook** (where applicable) — reuse the existing handler. **Do not create a second webhook endpoint.**

Name matching against existing players uses `pg_trgm` fuzzy matching with a confidence threshold; anything below the threshold is queued for manual admin review rather than auto-merged.

### 7.3 Roster export

`GET /api/admin/programs/:id/roster.csv` produces the registered-members export: child name, age, parent name, parent phone, parent email, payment status, registration date, notes.

Google Sheets sync is **optional and deferred**. CSV export is the deliverable. If Sheets is wanted later it should be a separate, scoped task using a service account with access to a single dedicated folder.

### 7.4 Acceptance criteria — Phase 4

- [ ] Creating a program generates correct `Schedule` rows with holidays excluded
- [ ] CSV import is idempotent and correctly maps orders to programs
- [ ] Sub-threshold name matches land in a review queue and are never auto-merged
- [ ] Roster CSV downloads with correct data and opens cleanly in Excel and Sheets
- [ ] No duplicate Stripe webhook endpoint was created

---

## 8. Phase 5 — Communications dispatch

Covers: **send email / SMS / WhatsApp to registered members.**

### 8.1 Composer

Admin UI: select a program → select an audience segment (all registered, unpaid only, waitlist, specific team) → choose channels → compose → **preview** → send.

The batch LLM (7B) can draft copy from the program record, but the draft is always shown to an admin for edit and explicit approval before anything sends. **No message ever sends without a human pressing send.**

### 8.2 Channels

- **Email** — reuse the existing Resend integration.
- **SMS** — Twilio SMS.
- **WhatsApp** — Twilio WhatsApp. **Critical constraint:** outside a 24-hour window since the recipient's last inbound message, WhatsApp permits only **pre-approved message templates**. Approval is a Meta process taking days, not a code change.

Submit these templates for approval early, in parallel with development:
1. Program starting reminder (program name, date, time, venue)
2. Registration confirmation (child name, program, start date)
3. Payment outstanding reminder (program, amount, payment link)
4. Schedule change notice (program, old date, new date)
5. Group invite (program, invite link)

The dispatcher must track per-recipient 24-hour window state and automatically select free-form vs. template. If no approved template exists for a needed message type, the UI must block the send and say why.

### 8.3 Delivery tracking

Persist per-recipient status: queued, sent, delivered, read, failed. Consume Twilio status callbacks. Surface a per-campaign summary in the admin console. Retry transient failures with backoff, max 3 attempts.

### 8.4 Acceptance criteria — Phase 5

- [ ] Nothing sends without explicit admin approval
- [ ] 24-hour window state is tracked correctly per recipient
- [ ] A send requiring an unapproved template is blocked with a clear reason
- [ ] Delivery statuses persist and display per campaign
- [ ] Opt-out (`STOP`) is honoured and suppresses all future sends to that number

---

## 9. Phase 6 — WhatsApp group handoff

**This step cannot be fully automated. Read §1.**

Neither Twilio's API nor Meta's Cloud API supports creating groups, adding participants, or editing group membership. The only programmatic route is an unofficial WhatsApp Web automation library, which risks a permanent ban on the business number and is explicitly forbidden.

**What gets built instead** — everything up to and after the manual step:

1. When a program hits a configured registration threshold, the platform creates a `ProgramGroup` record and notifies the admin: *"Fall Girls Basketball has 12 registrations. Create the WhatsApp group and paste the invite link."*
2. Admin creates the group manually in WhatsApp (30 seconds) and pastes the `chat.whatsapp.com` invite link into the admin UI.
3. Platform validates the link format, stores it, and **automatically distributes it** to every registered member via their preferred channel using the approved group-invite template.
4. Platform tracks who has been sent the invite, who hasn't, and re-sends to anyone registering later — so late registrants are picked up automatically with no admin action.
5. Admin console shows a reconciliation view: registered members vs. invites sent, so gaps are visible.

The human touch is reduced to one paste per program. Do not attempt to automate past that point.

### 9.1 Acceptance criteria — Phase 6

- [ ] Threshold trigger fires and notifies admin
- [ ] Invite link validated and stored
- [ ] Invites auto-distributed to all current registrants
- [ ] A member registering after group creation automatically receives the invite
- [ ] Reconciliation view accurate
- [ ] Zero unofficial WhatsApp libraries present anywhere in the dependency tree — verify with a lockfile audit

---

## 10. Phase 7 — Instagram publishing

Covers: **post to Instagram advertising the new program.**

### 10.1 Copy generation

The batch LLM generates the caption from the program record, following the established FaezSports listing format: enumerated session dates, per-session price breakdown, amenities, CTA. This format is non-negotiable and must be reproduced accurately — include it as an explicit few-shot example in the prompt, not as an instruction to "follow our usual format."

### 10.2 Publishing

Reuse the existing self-hosted Instagram tool on the VM. Constraint that must be respected: **Instagram requires media at a publicly accessible HTTPS URL** — direct byte upload is not supported. The media must be served from the existing public subdomain before the publish call is made.

Flow: generate copy → generate/select image → upload media to the public path → create IG media container → publish → store the resulting permalink against the program.

### 10.3 Admin-review gate

Before anything publishes, the draft caption, image, and registration link go to the admin WhatsApp group for review. Publishing occurs only on explicit approval. This mirrors the existing admin-review gate convention and is mandatory.

### 10.4 Acceptance criteria — Phase 7

- [ ] Generated copy matches the established listing format on a fixture set of 3 real past programs
- [ ] Media is served over public HTTPS before the publish call
- [ ] Nothing publishes without admin approval
- [ ] Permalink stored against the program
- [ ] Failed publishes surface a clear error to the admin, not a silent failure

---

## 11. Phase 8 — Admin console and observability

Single admin surface at `/admin` (Sanad is its own app, so no prefix). Auth: NextAuth credentials against Sanad's own `AdminUser` table, seeded from `SANAD_ADMIN_EMAIL` / `SANAD_ADMIN_PASSWORD`. Sections:

- **Live conversations** — inbound/outbound history per number, escalation state, manual takeover (pauses the bot for that conversation until released)
- **Escalation queue** — open items, assignable, resolvable
- **Knowledge editor** — CRUD on `KnowledgeDoc`, triggers re-index on save
- **Campaign history** — sends, delivery stats
- **Program pipeline** — per program: registrations, roster export, group invite status, Instagram post status
- **Health** — LLM service up/down, tokens/sec, p50/p95 latency, Twilio balance, error rate

Structured JSON logging throughout. **Never log message bodies containing PII at info level**; redact phone numbers and names in logs, keeping only conversation IDs.

---

## 12. Security requirements

- All LLM services bound to `127.0.0.1` only
- Twilio signature validation on every inbound webhook, no exceptions
- Instagram/Meta webhook signature validation
- Secrets in the systemd environment file (`/etc/sanad/sanad.env`), never committed
- The bot's database role is **read-only** for all model-facing tools; writes use a separate role scoped to the specific tables it must touch
- If any part of this runs in Docker, remember Docker bypasses `ufw` via iptables — verify actual port exposure with `ss -tulnp` and from an external host, not by reading firewall rules
- Rate limiting on all public endpoints
- No PII in URL query strings

---

## 13. Build order and sequencing

Strictly sequential. Each phase merges to staging, is verified, then production, before the next begins.

| Phase | Deliverable | Gate |
|---|---|---|
| 0 | Discovery + gap report | Alex signs off before any code |
| 1 | Self-hosted LLM services | Benchmarks recorded and acceptable |
| 2 | Knowledge layer + read-only tools | Eval harness passing |
| 3 | WhatsApp Q&A | **This is the primary feature — do not proceed past it until it is genuinely good** |
| 4 | Product creation + registration tracking + roster | Idempotent import verified |
| 5 | Comms dispatch | Templates submitted to Meta for approval |
| 6 | Group handoff | Lockfile audit clean |
| 7 | Instagram publishing | Copy format verified against real examples |
| 8 | Admin console | — |
| 3b | Instagram DM parity | After Phase 3 is stable, sequenced anywhere after Phase 7 |

---

## 14. Open items for Alex

These block or shape specific phases and need answers before the relevant phase starts:

1. **Knowledge content** — the seed policy/FAQ text for §5.1 does not exist in consolidated form yet. This is the single biggest determinant of answer quality.
2. **Twilio WhatsApp sender status** — is the number already an approved WhatsApp sender, or still on the sandbox? Template approval timelines depend on this.
3. **Meta template submission** — needs to start in parallel with Phase 1, not at Phase 5, or it becomes the critical path.
4. **Escalation destination** — which admin number(s) receive escalations, and what are the hours/expectations?
5. **Latency tolerance** — if the 3B model's answer quality proves insufficient, the trade-off is slower replies (7B) or a hosted model (faster and better, but conversation content leaves the VM). Decide the priority before Phase 3 tuning.
6. **Instagram DM scope** — comment-to-DM only, or full DM Q&A parity? Full parity roughly doubles the surface area of Phase 3b.
7. **Platform write path** — for Phase 4, should the platform expose a service-token admin API that Sanad calls, or should program creation / registration import be built in the platform repo with Sanad only reading results? Default assumption in this spec: service-token API.
8. **Read-only DB role** — a `sanad_ro` Postgres role on the Supabase project with `SELECT` on the platform tables and full rights on the `sanad` schema needs to be created before Phase 2. Sanad can supply the SQL.