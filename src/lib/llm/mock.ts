import type { ChatMessage, ChatOptions, ChatResult, LLMProvider, ToolDefinition } from "./provider";

type Scripted = Partial<Pick<ChatResult, "content" | "toolCalls" | "finishReason">>;

/** Deterministic provider for tests and the eval harness. Replays scripted turns in order. */
export class MockProvider implements LLMProvider {
  readonly name = "mock";
  readonly calls: { messages: ChatMessage[]; tools?: ToolDefinition[] }[] = [];
  private readonly queue: Scripted[];

  constructor(turns: Scripted[] = [], private readonly dims = 384) {
    this.queue = [...turns];
  }

  async chat(messages: ChatMessage[], _opts?: ChatOptions): Promise<ChatResult> {
    this.calls.push({ messages });
    return this.next();
  }

  async chatWithTools(messages: ChatMessage[], tools: ToolDefinition[], _opts?: ChatOptions): Promise<ChatResult> {
    this.calls.push({ messages, tools });
    return this.next();
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      const v = new Array<number>(this.dims).fill(0);
      for (let i = 0; i < t.length; i++) v[(t.charCodeAt(i) + i) % this.dims] += 1;
      const norm = Math.hypot(...v) || 1;
      return v.map((x) => x / norm);
    });
  }

  private next(): ChatResult {
    const turn = this.queue.shift() ?? { content: "" };
    const toolCalls = turn.toolCalls ?? [];
    return {
      content: turn.content ?? "",
      toolCalls,
      finishReason: turn.finishReason ?? (toolCalls.length ? "tool_calls" : "stop"),
      usage: { promptTokens: 0, completionTokens: 0 },
      ttfbMs: 0,
      latencyMs: 0,
    };
  }
}
