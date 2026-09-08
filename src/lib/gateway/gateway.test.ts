import { describe, expect, it } from "vitest";
import twilio from "twilio";
import { StaticFastPathSource } from "./fast-path";
import {
  handleInbound,
  type ConversationStore,
  type HandlerDeps,
  type NormalisedInbound,
  type Outbound,
  type StoredConversation,
} from "./handle-inbound";
import { classifyFastIntent, hasEscalationKeyword, isOptOut, isRepeatedQuestion } from "./intents";
import { MemoryRateLimiter } from "./rate-limit";
import { route } from "./router";
import { parseInbound, redactAddress, verifyTwilioSignature } from "./twilio";

describe("fast-path intents", () => {
  it.each([
    ["How do I register my daughter?", "register"],
    ["sign up link pls", "register"],
    ["When is the next game?", "schedule"],
    ["what time is practice", "schedule"],
    ["How much does it cost", "cost"],
    ["price?", "cost"],
    ["Where is the gym", "location"],
    ["is there parking", "location"],
    ["Can I pay by etransfer", "pay"],
    ["I want a refund", "refund"],
  ])("%s -> %s", (text, intent) => {
    expect(classifyFastIntent(text)).toBe(intent);
  });

  it("returns null for open-ended questions", () => {
    expect(classifyFastIntent("Is the program suitable for a shy 9 year old who has never played?")).toBeNull();
    expect(classifyFastIntent("")).toBeNull();
  });
});

describe("escalation and opt-out detection", () => {
  it("catches all explicit keywords from SPEC §6.2", () => {
    for (const t of ["refund please", "I have a complaint", "my son got injured", "she hurt her ankle", "EMERGENCY", "can I speak to someone", "human"]) {
      expect(hasEscalationKeyword(t)).toBe(true);
    }
    expect(hasEscalationKeyword("when is the next game")).toBe(false);
  });

  it("detects repeated questions ignoring case and punctuation", () => {
    expect(isRepeatedQuestion("When is the game??", "when is the game")).toBe(true);
    expect(isRepeatedQuestion("When is the game", "where is the game")).toBe(false);
    expect(isRepeatedQuestion("hi", undefined)).toBe(false);
  });

  it("recognises STOP variants only as whole messages", () => {
    expect(isOptOut("STOP")).toBe(true);
    expect(isOptOut(" unsubscribe ")).toBe(true);
    expect(isOptOut("please stop sending me the schedule")).toBe(false);
  });
});

describe("route()", () => {
  it("orders opt-out > escalation > repeat > fast > ai", () => {
    expect(route("STOP")).toEqual({ path: "OPT_OUT" });
    expect(route("I want a refund")).toEqual({ path: "ESCALATION", reason: "KEYWORD" });
    expect(route("What's your refund policy?")).toEqual({ path: "FAST", intent: "refund" });
    expect(route("how do refunds work")).toEqual({ path: "FAST", intent: "refund" });
    expect(route("when is the game", { previousInbound: "when is the game" })).toEqual({
      path: "ESCALATION",
      reason: "REPEATED_QUESTION",
    });
    expect(route("when is the game")).toEqual({ path: "FAST", intent: "schedule" });
    expect(route("is this good for beginners?")).toEqual({ path: "AI" });
  });
});

describe("MemoryRateLimiter", () => {
  it("allows 20 then blocks within the window, then frees after it", async () => {
    let now = 0;
    const rl = new MemoryRateLimiter(20, 1000, () => now);
    for (let i = 0; i < 20; i++) expect(await rl.hit("a")).toBe(true);
    expect(await rl.hit("a")).toBe(false);
    expect(await rl.hit("b")).toBe(true);
    now = 1001;
    expect(await rl.hit("a")).toBe(true);
  });
});

class FakeStore implements ConversationStore {
  seen = new Set<string>();
  convo: StoredConversation = { id: "c1", state: "BOT", optedOut: false };
  outbound: { body: string; routePath: string; intent?: string }[] = [];
  escalations: string[] = [];
  optedOut: boolean[] = [];

  async recordInbound(msg: NormalisedInbound) {
    if (this.seen.has(msg.providerSid)) return null;
    this.seen.add(msg.providerSid);
    return this.convo;
  }
  async recordOutbound(_id: string, body: string, meta: { routePath: string; intent?: string }) {
    this.outbound.push({ body, ...meta });
  }
  async setOptedOut(_id: string, v: boolean) {
    this.optedOut.push(v);
  }
  async escalate(_id: string, reason: string) {
    this.escalations.push(reason);
  }
}

class FakeOutbound implements Outbound {
  sent: string[] = [];
  admin: string[] = [];
  async send(_to: string, _ch: "WHATSAPP" | "INSTAGRAM", body: string) {
    this.sent.push(body);
  }
  async notifyAdmin(text: string) {
    this.admin.push(text);
  }
}

function makeDeps(overrides: Partial<HandlerDeps> = {}) {
  const store = new FakeStore();
  const outbound = new FakeOutbound();
  const deps: HandlerDeps = {
    store,
    outbound,
    limiter: new MemoryRateLimiter(),
    fastSource: new StaticFastPathSource("https://faezsports.com/register"),
    adminConsoleUrl: "https://sanad.faezsports.com",
    ...overrides,
  };
  return { deps, store, outbound };
}

const inbound = (body: string, sid = `SM${Math.random()}`): NormalisedInbound => ({
  channel: "WHATSAPP",
  externalAddress: "whatsapp:+14165550100",
  providerSid: sid,
  body,
});

describe("handleInbound", () => {
  it("is idempotent on Twilio retries (same MessageSid)", async () => {
    const { deps, outbound } = makeDeps();
    await handleInbound(inbound("how much", "SM1"), deps);
    const second = await handleInbound(inbound("how much", "SM1"), deps);
    expect(second).toEqual({ outcome: "duplicate" });
    expect(outbound.sent).toHaveLength(1);
  });

  it("answers fast-path intents without any LLM", async () => {
    const { deps, outbound, store } = makeDeps({ ai: { answer: async () => { throw new Error("LLM must not be called"); } } });
    const r = await handleInbound(inbound("how do I register"), deps);
    expect(r).toEqual({ outcome: "replied", path: "FAST", intent: "register" });
    expect(outbound.sent[0]).toContain("https://faezsports.com/register");
    expect(store.outbound[0].routePath).toBe("FAST");
  });

  it("escalates on keyword, notifies admin with a console deep link, and never leaks the phone number", async () => {
    const { deps, outbound, store } = makeDeps();
    const r = await handleInbound(inbound("my kid got injured at practice"), deps);
    expect(r).toEqual({ outcome: "escalated", reason: "KEYWORD" });
    expect(store.escalations).toEqual(["KEYWORD"]);
    expect(outbound.admin[0]).toContain("https://sanad.faezsports.com/admin/conversations/c1");
    expect(outbound.admin[0]).not.toContain("+14165550100");
  });

  it("escalates on repeated question", async () => {
    const { deps, store } = makeDeps();
    store.convo.previousInbound = "is this good for beginners";
    const r = await handleInbound(inbound("is this good for beginners?"), deps);
    expect(r).toEqual({ outcome: "escalated", reason: "REPEATED_QUESTION" });
  });

  it("escalates when the AI path throws (tool error) or returns nothing (ungrounded)", async () => {
    const a = makeDeps({ ai: { answer: async () => { throw new Error("boom"); } } });
    expect(await handleInbound(inbound("are shy kids ok?"), a.deps)).toEqual({ outcome: "escalated", reason: "TOOL_ERROR" });
    const b = makeDeps({ ai: { answer: async () => null } });
    expect(await handleInbound(inbound("are shy kids ok?"), b.deps)).toEqual({ outcome: "escalated", reason: "UNGROUNDED" });
  });

  it("escalates AI-path questions when no AI path is configured", async () => {
    const { deps } = makeDeps();
    expect(await handleInbound(inbound("are shy kids ok?"), deps)).toEqual({ outcome: "escalated", reason: "NO_RETRIEVAL" });
  });

  it("uses the AI path answer when grounded", async () => {
    const { deps, outbound } = makeDeps({ ai: { answer: async () => "Yes, beginners are welcome." } });
    expect(await handleInbound(inbound("are shy kids ok?"), deps)).toEqual({ outcome: "replied", path: "AI" });
    expect(outbound.sent).toEqual(["Yes, beginners are welcome."]);
  });

  it("honours STOP and stays silent under human takeover", async () => {
    const { deps, store } = makeDeps();
    expect(await handleInbound(inbound("STOP"), deps)).toEqual({ outcome: "opt_out" });
    expect(store.optedOut).toEqual([true]);
    store.convo.state = "HUMAN_TAKEOVER";
    const { deps: d2, outbound } = makeDeps({ store });
    expect(await handleInbound(inbound("hello?"), d2)).toEqual({ outcome: "paused" });
    expect(outbound.sent).toHaveLength(0);
  });

  it("stays silent after opt-out until START", async () => {
    const { deps, store, outbound } = makeDeps();
    store.convo.optedOut = true;
    expect(await handleInbound(inbound("how much is it"), deps)).toEqual({ outcome: "opted_out" });
    expect(outbound.sent).toHaveLength(0);
    expect(await handleInbound(inbound("START"), deps)).toEqual({ outcome: "replied", path: "SYSTEM" });
    expect(store.optedOut).toEqual([false]);
    expect(outbound.sent).toHaveLength(1);
  });

  it("throttles after the per-number limit", async () => {
    const { deps, outbound } = makeDeps({ limiter: new MemoryRateLimiter(1, 60_000) });
    await handleInbound(inbound("how much"), deps);
    expect(await handleInbound(inbound("how much again"), deps)).toEqual({ outcome: "throttled" });
    expect(outbound.sent[1]).toMatch(/few minutes/);
  });
});

describe("twilio helpers", () => {
  const token = "test_auth_token";
  const url = "https://sanad.faezsports.com/api/sanad/whatsapp/inbound";
  const params = {
    MessageSid: "SM123",
    AccountSid: "AC123",
    From: "whatsapp:+14165550100",
    To: "whatsapp:+14165550999",
    Body: "hi",
    NumMedia: "0",
  };

  it("accepts a correctly signed request and rejects tampered or missing signatures", () => {
    const sig = twilio.getExpectedTwilioSignature(token, url, params);
    expect(verifyTwilioSignature(token, sig, url, params)).toBe(true);
    expect(verifyTwilioSignature(token, sig, url, { ...params, Body: "changed" })).toBe(false);
    expect(verifyTwilioSignature(token, null, url, params)).toBe(false);
    expect(verifyTwilioSignature("other_token", sig, url, params)).toBe(false);
  });

  it("parses inbound params and coerces NumMedia", () => {
    const p = parseInbound(params);
    expect(p.NumMedia).toBe(0);
    expect(() => parseInbound({ ...params, From: "+14165550100" })).toThrow();
  });

  it("redacts addresses to the last four digits", () => {
    expect(redactAddress("whatsapp:+14165550100")).toBe("whatsapp:***0100");
  });
});
