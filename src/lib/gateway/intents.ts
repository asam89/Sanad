/**
 * Tier 1 deterministic routing (SPEC §6.2) and Tier 3 escalation keywords.
 * No LLM involvement anywhere in this file.
 */

export type FastIntent = "register" | "schedule" | "cost" | "location" | "refund" | "pay";

const FAST_PATTERNS: [FastIntent, RegExp][] = [
  ["refund", /\b(refund|withdraw(al)?|money back|cancel (my|the|our) (registration|spot))\b/i],
  ["register", /\b(regist(er|ration)|sign ?up|enrol{1,2}(ment)?|how (do|can) (i|we) join)\b/i],
  ["schedule", /\b(schedule|when (is|are|does)|what time|next (game|session|practice)|game ?day|dates?)\b/i],
  ["cost", /\b(cost|price|pricing|how much|fee|fees|\$\s?\d)/i],
  ["location", /\b(where|location|address|venue|gym|directions|parking)\b/i],
  ["pay", /\b(pay|payment|paid|e-?transfer|invoice|owe|outstanding)\b/i],
];

export function classifyFastIntent(text: string): FastIntent | null {
  const t = text.trim();
  if (t.length === 0 || t.length > 300) return null;
  for (const [intent, re] of FAST_PATTERNS) if (re.test(t)) return intent;
  return null;
}

/** Explicit Tier 3 triggers; `refund` is both a fast intent and an escalation, escalation wins. */
const ESCALATION_KEYWORDS =
  /\b(refund|complaint|complain|injur(y|ed|ies)|hurt|emergency|speak to (someone|a person|a human)|talk to (someone|a person|a human)|human|real person|agent)\b/i;

export function hasEscalationKeyword(text: string): boolean {
  return ESCALATION_KEYWORDS.test(text);
}

const OPT_OUT = /^\s*(stop|unsubscribe|cancel|end|quit|stopall)\s*$/i;

export function isOptOut(text: string): boolean {
  return OPT_OUT.test(text);
}

/** Implicit escalation: same question twice in a row (normalised). */
export function isRepeatedQuestion(current: string, previousInbound: string | undefined): boolean {
  if (!previousInbound) return false;
  return normalise(current) === normalise(previousInbound) && normalise(current).length > 0;
}

function normalise(s: string) {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}
