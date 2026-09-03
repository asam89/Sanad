# Sanad

**Sanad** (سند, "support") is the FaezSports WhatsApp assistant and program launch pipeline.

- Answers parent / player questions on the FaezSports WhatsApp number, grounded on real platform data.
- Runs the program launch pipeline: product creation, registration tracking, roster export, comms dispatch, WhatsApp group handoff, Instagram publishing.
- All inference is self-hosted on the OCI VM. No PII leaves the box.

Full specification: [`docs/SPEC.md`](docs/SPEC.md). Build progress: [`docs/PROGRESS.md`](docs/PROGRESS.md).

## Stack

Next.js 14 (App Router) · TypeScript · Prisma · PostgreSQL (Supabase) · Valkey · Twilio WhatsApp Business API · `llama.cpp` (`llama-server`) · Vitest

## Local development

```bash
cp .env.example .env      # fill in DATABASE_URL etc.
npm install
npx prisma generate
npm run dev               # http://localhost:3100
npm test
npm run lint && npm run typecheck
```

## Hard guards

See [`docs/SPEC.md §1`](docs/SPEC.md). In short: Twilio only (no unofficial WhatsApp libraries), the LLM never writes to the database, no PII to third-party APIs, LLM services bind to `127.0.0.1` only, and Sanad never migrates platform tables.
