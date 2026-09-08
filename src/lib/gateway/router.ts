import {
  classifyFastIntent,
  hasEscalationKeyword,
  isOptOut,
  isRefundPolicyQuestion,
  isRepeatedQuestion,
  type FastIntent,
} from "./intents";

export type RouteDecision =
  | { path: "OPT_OUT" }
  | { path: "ESCALATION"; reason: "KEYWORD" | "REPEATED_QUESTION" }
  | { path: "FAST"; intent: FastIntent }
  | { path: "AI" };

export interface RouteContext {
  /** Body of the previous inbound message in this conversation, if any. */
  previousInbound?: string;
}

/**
 * Pure routing decision for one inbound message. Ordering matters:
 * opt-out > explicit escalation > repeated question > fast path > AI.
 */
export function route(text: string, ctx: RouteContext = {}): RouteDecision {
  if (isOptOut(text)) return { path: "OPT_OUT" };
  if (isRefundPolicyQuestion(text)) return { path: "FAST", intent: "refund" };
  if (hasEscalationKeyword(text)) return { path: "ESCALATION", reason: "KEYWORD" };
  if (isRepeatedQuestion(text, ctx.previousInbound)) return { path: "ESCALATION", reason: "REPEATED_QUESTION" };
  const intent = classifyFastIntent(text);
  if (intent) return { path: "FAST", intent };
  return { path: "AI" };
}

export const THROTTLE_REPLY =
  "You have sent quite a few messages in a short time. Give me a few minutes and try again, or reply HUMAN to reach the FaezSports team.";

export const ESCALATION_REPLY =
  "Thanks for reaching out. I have passed this to the FaezSports team and someone will follow up with you personally.";

export const OPT_OUT_REPLY =
  "You have been unsubscribed from FaezSports messages. Reply START at any time to opt back in.";

export const OPT_IN_REPLY = "Welcome back. You will receive FaezSports messages again. How can I help?";
