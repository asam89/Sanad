import type { Channel, EscalationReason, RoutePath } from "@prisma/client";
import { fastReply, type FastPathSource } from "./fast-path";
import type { RateLimiter } from "./rate-limit";
import { ESCALATION_REPLY, OPT_IN_REPLY, OPT_OUT_REPLY, route, THROTTLE_REPLY } from "./router";

/** Channel-neutral inbound shape (SPEC §6.5: WhatsApp and Instagram normalise to this). */
export interface NormalisedInbound {
  channel: Channel;
  externalAddress: string;
  providerSid: string;
  body: string;
}

export interface StoredConversation {
  id: string;
  state: "BOT" | "ESCALATED" | "HUMAN_TAKEOVER";
  optedOut: boolean;
  previousInbound?: string;
}

/** Persistence seam so the handler is unit-testable without Postgres. */
export interface ConversationStore {
  /** Returns null when providerSid was already seen (idempotent retry). */
  recordInbound(msg: NormalisedInbound): Promise<StoredConversation | null>;
  recordOutbound(conversationId: string, body: string, meta: { routePath: RoutePath; intent?: string }): Promise<void>;
  setOptedOut(conversationId: string, optedOut: boolean): Promise<void>;
  escalate(conversationId: string, reason: EscalationReason, excerpt: string): Promise<void>;
}

export interface Outbound {
  send(to: string, channel: Channel, body: string): Promise<void>;
  notifyAdmin(text: string): Promise<void>;
}

export interface AiPath {
  /** Returns the reply, or null to escalate. Must respect the 45 s hard timeout itself. */
  answer(conversationId: string, msg: NormalisedInbound): Promise<string | null>;
}

export interface HandlerDeps {
  store: ConversationStore;
  outbound: Outbound;
  limiter: RateLimiter;
  fastSource: FastPathSource;
  ai?: AiPath;
  adminConsoleUrl: string;
}

export type HandleResult =
  | { outcome: "duplicate" }
  | { outcome: "paused" }
  | { outcome: "opted_out" }
  | { outcome: "throttled" }
  | { outcome: "opt_out" }
  | { outcome: "replied"; path: RoutePath; intent?: string }
  | { outcome: "escalated"; reason: EscalationReason };

/**
 * Runs after the webhook has already returned 200. Everything here is
 * asynchronous relative to Twilio.
 */
export async function handleInbound(msg: NormalisedInbound, deps: HandlerDeps): Promise<HandleResult> {
  const convo = await deps.store.recordInbound(msg);
  if (!convo) return { outcome: "duplicate" };

  const reply = async (body: string, routePath: RoutePath, intent?: string) => {
    await deps.store.recordOutbound(convo.id, body, { routePath, intent });
    await deps.outbound.send(msg.externalAddress, msg.channel, body);
  };

  const decision = route(msg.body, { previousInbound: convo.previousInbound });

  if (decision.path === "OPT_OUT") {
    await deps.store.setOptedOut(convo.id, true);
    await reply(OPT_OUT_REPLY, "SYSTEM");
    return { outcome: "opt_out" };
  }

  if (convo.optedOut) {
    if (!/^\s*(start|unstop|yes)\s*$/i.test(msg.body)) return { outcome: "opted_out" };
    await deps.store.setOptedOut(convo.id, false);
    await reply(OPT_IN_REPLY, "SYSTEM");
    return { outcome: "replied", path: "SYSTEM" };
  }

  if (convo.state === "HUMAN_TAKEOVER") return { outcome: "paused" };

  if (!(await deps.limiter.hit(msg.externalAddress))) {
    await reply(THROTTLE_REPLY, "THROTTLE");
    return { outcome: "throttled" };
  }

  const escalate = async (reason: EscalationReason) => {
    await deps.store.escalate(convo.id, reason, msg.body.slice(0, 500));
    await reply(ESCALATION_REPLY, "ESCALATION");
    await deps.outbound.notifyAdmin(
      `Sanad escalation (${reason})\nConversation: ${deps.adminConsoleUrl}/admin/conversations/${convo.id}\n\n"${msg.body.slice(0, 300)}"`,
    );
    return { outcome: "escalated", reason } as const;
  };

  if (decision.path === "ESCALATION") return escalate(decision.reason);

  if (decision.path === "FAST") {
    try {
      const body = await fastReply(decision.intent, msg.externalAddress, deps.fastSource);
      await reply(body, "FAST", decision.intent);
      return { outcome: "replied", path: "FAST", intent: decision.intent };
    } catch {
      return escalate("TOOL_ERROR");
    }
  }

  if (!deps.ai) return escalate("NO_RETRIEVAL");
  try {
    const answer = await deps.ai.answer(convo.id, msg);
    if (!answer) return escalate("UNGROUNDED");
    await reply(answer, "AI");
    return { outcome: "replied", path: "AI" };
  } catch {
    return escalate("TOOL_ERROR");
  }
}
