# Sanad demo on a Mac Mini

Runs the whole stack locally: Postgres, Ollama (Metal), the Sanad gateway, and a
browser simulator that drives the real WhatsApp inbound pipeline without Twilio.
Twilio can be attached later by pointing a sandbox sender at a tunnel.

Everything, including inference, stays on the Mac. No roster data leaves the machine.

## 1. Prerequisites (one time)

```bash
brew install node@20 postgresql@16 ollama
brew services start postgresql@16
brew services start ollama

createdb sanad

ollama pull qwen2.5:7b          # chat + tool calling  (~4.7 GB)
ollama pull nomic-embed-text    # embeddings          (~275 MB)
```

Apple Silicon with 16 GB RAM runs `qwen2.5:7b` comfortably. On 8 GB use
`qwen2.5:3b` (`LLM_CHAT_MODEL=qwen2.5:3b`); answers are noticeably weaker.

Ollama only listens on `127.0.0.1:11434` by default. Leave it that way; Sanad
refuses any LLM URL that is not loopback.

## 2. Configure

```bash
git clone https://github.com/asam89/Sanad.git ~/Sanad
cd ~/Sanad
npm ci
cp .env.example .env
```

Edit `.env` — for the simulator-only demo these are the lines that matter:

```
DATABASE_URL=postgresql://localhost:5432/sanad
SANAD_PUBLIC_URL=http://localhost:3100
SANAD_ADMIN_PASSWORD=<pick something>

LLM_PROVIDER=local
LLM_CHAT_URL=http://127.0.0.1:11434
LLM_EMBED_URL=http://127.0.0.1:11434
LLM_CHAT_MODEL=qwen2.5:7b
LLM_EMBED_MODEL=nomic-embed-text

# Twilio is not needed for the simulator; keep the placeholders so env validation passes.
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=placeholder
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
```

## 3. Seed and index

```bash
npm run demo:setup
```

This applies the Prisma migration, seeds the demo venue / two programs /
sixteen sessions / two registrations, loads `docs/knowledge/*.md`, and embeds
the knowledge chunks with Ollama.

Re-run `npm run knowledge:reindex` whenever you edit a knowledge doc.

## 4. Run

```bash
npm run build
npm start          # http://localhost:3100
```

For development use `npm run dev` instead.

## 5. Demo walkthrough

Open http://localhost:3100/admin/simulator (user `admin`, password from `.env`).

Two seeded families:

| Phone | Child | Program | Payment |
|---|---|---|---|
| `+14165550100` | Maya, 10 | Fall Girls Basketball | paid |
| `+14165550200` | Zara, 11 | Fall Girls Basketball | unpaid |

Suggested script, in order:

1. `How much is the girls basketball program?` — deterministic fast path, ~10 ms, prices from the DB.
2. `When is my daughter's next practice?` — fast path, scoped to the sender's phone; switch to `+14165550200` to show it answers for Zara instead.
3. `Is my payment done?` — fast path; Maya says paid, Zara says outstanding.
4. `Where is the gym and is there parking?` — fast path from the venue table.
5. `What's your refund policy?` — fast path, text pulled from the indexed knowledge doc.
6. `What should my son bring to the first session?` — AI path: knowledge retrieval → local model → grounded reply. Expect 3–8 s on a Mac Mini.
7. `Do you offer a sibling discount?` — AI path with retrieved FAQ passage.
8. `My kid got hurt at practice yesterday` — safety keyword → immediate escalation, no LLM involved.
9. `STOP` — opt-out ack; further messages are ignored until `START`.

Then open **Conversations** and **Escalations** in the admin nav to show the
persisted thread, route path / latency per message, and the human takeover
toggle. **Programs** shows the seeded data and which knowledge docs are indexed.

Every message in the simulator went through the same `handleInbound` the
Twilio webhook uses; only the transport is faked.

## 6. Optional: real WhatsApp via Twilio sandbox

1. Twilio Console → Messaging → Try it out → WhatsApp sandbox. Note the sandbox number and join code.
2. Expose port 3100: `cloudflared tunnel --url http://localhost:3100` (or `ngrok http 3100`). Copy the https URL.
3. In `.env` set `SANAD_PUBLIC_URL=https://<tunnel-host>`, real `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_WHATSAPP_FROM=whatsapp:+14155238886`. Restart Sanad.
4. Sandbox settings → "When a message comes in": `https://<tunnel-host>/api/sanad/whatsapp/inbound`, POST.
5. Join the sandbox from a phone whose number is `+14165550100` or `+14165550200` in the seed (edit `prisma/seed.ts` to use your own number and re-run `npm run db:seed`).

Signature validation is enforced against `SANAD_PUBLIC_URL`, so the tunnel
host must match exactly.

## 7. Keep it running (launchd)

```bash
sed "s#__SANAD_DIR__#$HOME/Sanad#g; s#__NODE__#$(dirname $(which node))#g; s#__HOME__#$HOME#g" \
  deploy/launchd/com.faezsports.sanad.plist > ~/Library/LaunchAgents/com.faezsports.sanad.plist
launchctl load ~/Library/LaunchAgents/com.faezsports.sanad.plist
tail -f ~/Library/Logs/sanad.log
```

`launchctl unload ~/Library/LaunchAgents/com.faezsports.sanad.plist` stops it.
Rebuild (`npm run build`) then `launchctl kickstart -k gui/$(id -u)/com.faezsports.sanad` after pulling changes.

## Known demo limitations

- Knowledge docs in `docs/knowledge/` are **drafts**; replace with approved FaezSports text before showing parents.
- Program data is a local Sanad-owned copy, not the platform DB (SPEC §0.1 read-only mirror comes with Phase 0 discovery).
- Rate limiting is in-memory; fine for one process.
- With `qwen2.5:3b` the model occasionally over-answers (adds registration facts you did not ask about). `qwen2.5:7b` is the recommended demo model.
