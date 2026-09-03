# Self-hosted LLM setup (SPEC Phase 1)

Everything here runs on the OCI Ampere VM. Nothing binds outside `127.0.0.1`.

## 1. Build llama.cpp (pinned)

```bash
# on the VM, from a checkout of this repo
./deploy/llm/build.sh
```

The commit is read from `deploy/llm/LLAMA_CPP_COMMIT`. **Before the first VM build**, replace the placeholder with the full SHA you are building (pick the current upstream `master` head, verify it builds, then pin). Never track `master`.

The VM is Neoverse N1 (Armv8.2-A, `dotprod`, no `i8mm`, no SVE). `-DGGML_NATIVE=ON` compiles for exactly this; do not use a prebuilt x86 or generic binary.

## 2. Models

```bash
./deploy/llm/download-models.sh   # into /opt/models, ~7 GB total
```

| Role | Model | File | Port |
|---|---|---|---|
| Chat (interactive) | Qwen2.5-3B-Instruct Q4_K_M | `Qwen2.5-3B-Instruct-Q4_K_M.gguf` | 8081 |
| Batch (offline copy) | Qwen2.5-7B-Instruct Q4_K_M | `Qwen2.5-7B-Instruct-Q4_K_M-0000{1,2}-of-00002.gguf` | 8082 |
| Embeddings | bge-small-en-v1.5 q8_0 (384-dim) | `bge-small-en-v1.5-q8_0.gguf` | 8083 |

GGUF files are git-ignored and never committed.

## 3. systemd

```bash
sudo useradd --system --no-create-home sanad || true
sudo cp deploy/systemd/sanad-llm-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now sanad-llm-chat sanad-llm-embed
# batch is on-demand; start it only when a batch job needs it:
sudo systemctl start sanad-llm-batch
```

All three units use `--host 127.0.0.1`, `Restart=on-failure`, and a `MemoryMax` cap so a runaway model cannot starve the platform.

## 4. Verify

From the VM:

```bash
curl -s 127.0.0.1:8081/v1/chat/completions -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"Say hi in five words."}],"max_tokens":20}'
curl -s 127.0.0.1:8083/v1/embeddings -H 'content-type: application/json' -d '{"input":["hello"]}' | head -c 200
ss -tulnp | grep -E '808[123]'      # every line must show 127.0.0.1, never 0.0.0.0 or *
```

From **outside** the VM (your laptop): `curl -m 5 http://140.238.131.77:8081/health` must fail to connect. Check with `ss`, not by reading `ufw` rules.

## 5. Benchmark

```bash
LLM_CHAT_URL=http://127.0.0.1:8081 LLM_BATCH_URL=http://127.0.0.1:8082 npm run llm:bench
```

Record the output here once run on the VM.

| Model | tokens/sec | TTFT p50 | TTFT p95 | Total p50 (120 tok) | Total p95 |
|---|---|---|---|---|---|
| Qwen2.5-3B Q4_K_M | _pending_ | | | | |
| Qwen2.5-7B Q4_K_M | _pending_ | | | | |

Acceptance (SPEC §4.5): 3B total p95 for a 120-token answer must be comfortably under the 45 s hard timeout and ideally under 15 s.

## 6. App-side

`LLM_PROVIDER=local` (default) selects `LocalLlamaProvider` (`src/lib/llm/local-llama.ts`), which refuses any non-loopback URL at construction. `LLM_PROVIDER=mock` selects the deterministic `MockProvider` used by tests and `npm run sanad:eval`.
