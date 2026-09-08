import { env } from "@/lib/env";
import { StaticFastPathSource } from "./fast-path";
import type { HandlerDeps } from "./handle-inbound";
import { PrismaConversationStore } from "./prisma-store";
import { MemoryRateLimiter } from "./rate-limit";
import { TwilioOutbound } from "./twilio-outbound";

let deps: HandlerDeps | undefined;

export function productionDeps(): HandlerDeps {
  if (deps) return deps;
  const e = env();
  deps = {
    store: new PrismaConversationStore(),
    outbound: new TwilioOutbound(),
    limiter: new MemoryRateLimiter(),
    fastSource: new StaticFastPathSource(process.env.FAEZSPORTS_REGISTRATION_URL ?? "https://faezsports.com"),
    adminConsoleUrl: e.SANAD_PUBLIC_URL,
  };
  return deps;
}
