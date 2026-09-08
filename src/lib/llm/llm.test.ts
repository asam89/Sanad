import { describe, expect, it } from "vitest";
import { LocalLlamaProvider } from "./local-llama";
import { MockProvider } from "./mock";
import type { LLMProvider } from "./provider";

async function exerciseProvider(p: LLMProvider) {
  const r = await p.chat([{ role: "user", content: "hi" }]);
  expect(typeof r.content).toBe("string");
  const [v] = await p.embed(["hello"]);
  expect(v.length).toBe(384);
}

describe("MockProvider", () => {
  it("satisfies the LLMProvider contract", async () => {
    await exerciseProvider(new MockProvider([{ content: "hello" }]));
  });

  it("replays scripted tool calls", async () => {
    const p = new MockProvider([
      { toolCalls: [{ id: "1", name: "get_next_session", arguments: '{"programId":"p1"}' }] },
      { content: "Next session is Saturday." },
    ]);
    const first = await p.chatWithTools([{ role: "user", content: "when?" }], []);
    expect(first.finishReason).toBe("tool_calls");
    expect(first.toolCalls[0].name).toBe("get_next_session");
    const second = await p.chat([]);
    expect(second.content).toMatch(/Saturday/);
    expect(p.calls).toHaveLength(2);
  });

  it("produces deterministic unit-norm embeddings", async () => {
    const p = new MockProvider();
    const [a, b] = await p.embed(["refund policy", "refund policy"]);
    expect(a).toEqual(b);
    expect(Math.hypot(...a)).toBeCloseTo(1, 5);
  });
});

describe("LocalLlamaProvider", () => {
  it("refuses non-loopback endpoints", () => {
    expect(
      () => new LocalLlamaProvider({ chatUrl: "http://0.0.0.0:8081", embedUrl: "http://127.0.0.1:8083" }),
    ).toThrow(/loopback/);
    expect(
      () => new LocalLlamaProvider({ chatUrl: "http://127.0.0.1:8081", embedUrl: "https://api.openai.com" }),
    ).toThrow(/loopback/);
  });

  it("maps OpenAI-shaped responses, including tool calls", async () => {
    const seen: { url: string; body: unknown }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      if (String(url).endsWith("/v1/embeddings")) {
        return new Response(JSON.stringify({ data: [{ index: 0, embedding: new Array(384).fill(0.1) }] }));
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                content: null,
                tool_calls: [{ id: "c1", function: { name: "list_open_programs", arguments: "{}" } }],
              },
            },
          ],
          usage: { prompt_tokens: 12, completion_tokens: 8 },
        }),
      );
    }) as typeof fetch;

    const p = new LocalLlamaProvider({
      chatUrl: "http://127.0.0.1:8081",
      embedUrl: "http://127.0.0.1:8083",
      fetchImpl,
    });
    const r = await p.chatWithTools(
      [{ role: "user", content: "what's open?" }],
      [{ name: "list_open_programs", description: "d", parameters: { type: "object", properties: {} } }],
    );
    expect(r.finishReason).toBe("tool_calls");
    expect(r.toolCalls).toEqual([{ id: "c1", name: "list_open_programs", arguments: "{}" }]);
    expect(r.usage.promptTokens).toBe(12);
    expect(seen[0].url).toBe("http://127.0.0.1:8081/v1/chat/completions");
    expect((seen[0].body as { tools: unknown[] }).tools).toHaveLength(1);

    await exerciseProvider(p);
  });
});
