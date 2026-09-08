import { env } from "@/lib/env";
import { LocalLlamaProvider } from "./local-llama";
import { MockProvider } from "./mock";
import type { LLMProvider } from "./provider";

export type { ChatMessage, ChatResult, LLMProvider, ToolCall, ToolDefinition } from "./provider";
export { LocalLlamaProvider, MockProvider };

let instance: LLMProvider | undefined;

/** Provider selected by LLM_PROVIDER (SPEC §4.4). */
export function getLLM(): LLMProvider {
  if (instance) return instance;
  const e = env();
  instance =
    e.LLM_PROVIDER === "mock"
      ? new MockProvider()
      : new LocalLlamaProvider({
          chatUrl: e.LLM_CHAT_URL,
          batchUrl: e.LLM_BATCH_URL,
          embedUrl: e.LLM_EMBED_URL,
          chatModel: e.LLM_CHAT_MODEL,
          batchModel: e.LLM_BATCH_MODEL,
          embedModel: e.LLM_EMBED_MODEL,
        });
  return instance;
}
