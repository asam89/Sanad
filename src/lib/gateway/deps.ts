import { ToolAgent } from "@/lib/agent/answer";
import { PrismaHistory } from "@/lib/agent/prisma-history";
import { env } from "@/lib/env";
import { CosineKnowledgeSearch } from "@/lib/knowledge";
import { PrismaChunkStore } from "@/lib/knowledge/prisma-chunk-store";
import { getLLM } from "@/lib/llm";
import { ToolRegistry } from "@/lib/tools";
import { PrismaProgramData } from "@/lib/tools/prisma-program-data";
import { ProgramFastPathSource } from "./fast-path";
import type { HandlerDeps, Outbound } from "./handle-inbound";
import { PrismaConversationStore } from "./prisma-store";
import { MemoryRateLimiter } from "./rate-limit";
import { TwilioOutbound } from "./twilio-outbound";

let deps: HandlerDeps | undefined;

const log = (event: Record<string, unknown>) => console.log(JSON.stringify({ level: "info", ...event }));

export function buildDeps(outbound: Outbound): HandlerDeps {
  const e = env();
  const llm = getLLM();
  const data = new PrismaProgramData();
  const knowledge = new CosineKnowledgeSearch(new PrismaChunkStore(), llm);
  return {
    store: new PrismaConversationStore(),
    outbound,
    limiter: new MemoryRateLimiter(),
    fastSource: new ProgramFastPathSource(data, knowledge, e.FAEZSPORTS_REGISTRATION_URL),
    ai: new ToolAgent(llm, new ToolRegistry(data, knowledge), new PrismaHistory(), knowledge, { log }),
    adminConsoleUrl: e.SANAD_PUBLIC_URL,
  };
}

export function productionDeps(): HandlerDeps {
  if (!deps) deps = buildDeps(new TwilioOutbound());
  return deps;
}
