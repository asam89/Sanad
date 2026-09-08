import { LocalLlamaProvider } from "../src/lib/llm/local-llama";

const PROMPT =
  "In about 120 words, explain to a parent how weather cancellations and makeup sessions work for a youth basketball program. Be warm and brief.";
const RUNS = Number(process.env.BENCH_RUNS ?? 5);

function pct(xs: number[], p: number) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

async function bench(label: string, url: string) {
  const p = new LocalLlamaProvider({ chatUrl: url, embedUrl: "http://127.0.0.1:8083" });
  const ttfb: number[] = [];
  const total: number[] = [];
  const tps: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const r = await p.chat([{ role: "user", content: PROMPT }], { maxTokens: 160, temperature: 0.3 });
    ttfb.push(r.ttfbMs);
    total.push(r.latencyMs);
    tps.push(r.usage.completionTokens / (r.latencyMs / 1000));
  }
  console.log(
    `| ${label} | ${(tps.reduce((a, b) => a + b, 0) / tps.length).toFixed(1)} | ${pct(ttfb, 50)} ms | ${pct(ttfb, 95)} ms | ${pct(total, 50)} ms | ${pct(total, 95)} ms |`,
  );
}

async function main() {
  console.log("| Model | tokens/sec | TTFT p50 | TTFT p95 | Total p50 | Total p95 |");
  console.log("|---|---|---|---|---|---|");
  await bench("chat (3B)", process.env.LLM_CHAT_URL ?? "http://127.0.0.1:8081");
  if (process.env.LLM_BATCH_URL) await bench("batch (7B)", process.env.LLM_BATCH_URL);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
