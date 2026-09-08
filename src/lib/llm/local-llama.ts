import { z } from "zod";
import type {
  ChatMessage,
  ChatOptions,
  ChatResult,
  LLMProvider,
  ToolCall,
  ToolDefinition,
} from "./provider";

export interface LocalLlamaConfig {
  chatUrl: string;
  batchUrl?: string;
  embedUrl: string;
  /** Model names sent in the request body. llama-server ignores them; Ollama requires them. */
  chatModel?: string;
  batchModel?: string;
  embedModel?: string;
  fetchImpl?: typeof fetch;
}

const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({
          content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                id: z.string().optional(),
                function: z.object({
                  name: z.string(),
                  arguments: z.union([z.string(), z.record(z.unknown())]),
                }),
              }),
            )
            .optional(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({ prompt_tokens: z.number(), completion_tokens: z.number() })
    .optional(),
});

const embeddingSchema = z.object({
  data: z.array(z.object({ embedding: z.array(z.number()), index: z.number() })),
});

function assertLoopback(url: string) {
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`LLM endpoint must be loopback only, got ${host} (SPEC §4.3)`);
  }
}

/**
 * Talks to an OpenAI-compatible local server (llama-server on the VM, Ollama on
 * the Mac Mini). Enforces that every endpoint is loopback so inference never
 * leaves the box.
 */
export class LocalLlamaProvider implements LLMProvider {
  readonly name = "local-llama";
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly cfg: LocalLlamaConfig) {
    assertLoopback(cfg.chatUrl);
    assertLoopback(cfg.embedUrl);
    if (cfg.batchUrl) assertLoopback(cfg.batchUrl);
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult> {
    return this.complete(this.cfg.chatUrl, this.cfg.chatModel, messages, undefined, opts);
  }

  chatWithTools(messages: ChatMessage[], tools: ToolDefinition[], opts?: ChatOptions): Promise<ChatResult> {
    return this.complete(this.cfg.chatUrl, this.cfg.chatModel, messages, tools, opts);
  }

  /** Same contract as chat() but routed to the larger, slower batch model. */
  chatBatch(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult> {
    return this.complete(
      this.cfg.batchUrl ?? this.cfg.chatUrl,
      this.cfg.batchModel ?? this.cfg.chatModel,
      messages,
      undefined,
      opts,
    );
  }

  async embed(texts: string[]): Promise<number[][]> {
    const res = await this.fetchImpl(`${this.cfg.embedUrl}/v1/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: texts, model: this.cfg.embedModel }),
    });
    if (!res.ok) throw new Error(`embed failed: HTTP ${res.status}`);
    const parsed = embeddingSchema.parse(await res.json());
    return parsed.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }

  private async complete(
    baseUrl: string,
    model: string | undefined,
    messages: ChatMessage[],
    tools: ToolDefinition[] | undefined,
    opts: ChatOptions = {},
  ): Promise<ChatResult> {
    const controller = new AbortController();
    const timer = opts.timeoutMs ? setTimeout(() => controller.abort(), opts.timeoutMs) : undefined;
    const started = Date.now();
    try {
      const res = await this.fetchImpl(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: messages.map(toOpenAiMessage),
          tools: tools?.map((t) => ({
            type: "function",
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
          temperature: opts.temperature ?? 0.2,
          max_tokens: opts.maxTokens ?? 400,
          stream: false,
        }),
      });
      const ttfbMs = Date.now() - started;
      opts.onFirstToken?.();
      if (!res.ok) throw new Error(`chat failed: HTTP ${res.status}`);
      const parsed = completionSchema.parse(await res.json());
      const choice = parsed.choices[0];
      const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((c, i) => ({
        id: c.id ?? `call_${i}`,
        name: c.function.name,
        arguments:
          typeof c.function.arguments === "string" ? c.function.arguments : JSON.stringify(c.function.arguments),
      }));
      return {
        content: choice.message.content ?? "",
        toolCalls,
        finishReason: normaliseFinish(choice.finish_reason, toolCalls.length > 0),
        usage: {
          promptTokens: parsed.usage?.prompt_tokens ?? 0,
          completionTokens: parsed.usage?.completion_tokens ?? 0,
        },
        ttfbMs,
        latencyMs: Date.now() - started,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

function toOpenAiMessage(m: ChatMessage) {
  if (m.role === "tool") return { role: "tool", content: m.content, tool_call_id: m.toolCallId };
  if (m.role === "assistant" && m.toolCalls?.length) {
    return {
      role: "assistant",
      content: m.content || null,
      tool_calls: m.toolCalls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: c.arguments },
      })),
    };
  }
  return { role: m.role, content: m.content };
}

function normaliseFinish(reason: string | null | undefined, hasTools: boolean): ChatResult["finishReason"] {
  if (hasTools || reason === "tool_calls") return "tool_calls";
  if (reason === "stop") return "stop";
  if (reason === "length") return "length";
  return "unknown";
}
