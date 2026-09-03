import { z } from "zod";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Present on role="tool" replies. */
  toolCallId?: string;
  /** Present on assistant messages that requested tools. */
  toolCalls?: ToolCall[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string as produced by the model; callers validate with Zod. */
  arguments: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** Abort the request after this many ms. */
  timeoutMs?: number;
  onFirstToken?: () => void;
}

export interface ChatResult {
  content: string;
  toolCalls: ToolCall[];
  finishReason: "stop" | "tool_calls" | "length" | "unknown";
  usage: { promptTokens: number; completionTokens: number };
  ttfbMs: number;
  latencyMs: number;
}

/**
 * Single seam between Sanad and any inference backend. OpenAI-shaped so a
 * hosted provider can be swapped in by config alone (SPEC §4.4).
 */
export interface LLMProvider {
  readonly name: string;
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult>;
  chatWithTools(messages: ChatMessage[], tools: ToolDefinition[], opts?: ChatOptions): Promise<ChatResult>;
  embed(texts: string[]): Promise<number[][]>;
}

export const toolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.string(),
});
