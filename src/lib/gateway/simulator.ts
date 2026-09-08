import type { Channel } from "@prisma/client";
import { buildDeps } from "./deps";
import { handleInbound, type HandlerDeps, type HandleResult, type Outbound } from "./handle-inbound";

export interface SimulatedTurn {
  result: HandleResult;
  replies: string[];
  adminNotices: string[];
  latencyMs: number;
}

/** Captures outbound messages in memory instead of sending them through Twilio. */
class CapturingOutbound implements Outbound {
  replies: string[] = [];
  adminNotices: string[] = [];
  async send(_to: string, _channel: Channel, body: string) {
    this.replies.push(body);
  }
  async notifyAdmin(text: string) {
    this.adminNotices.push(text);
  }
}

let cached: { deps: HandlerDeps; outbound: CapturingOutbound } | undefined;

/**
 * Runs the real gateway (store, router, tools, LLM) against a synthetic
 * inbound so the assistant can be demoed without a Twilio sender. Uses the
 * same database as the webhook; simulated threads show up in /admin.
 */
export async function simulateInbound(from: string, body: string): Promise<SimulatedTurn> {
  if (!cached) {
    const outbound = new CapturingOutbound();
    cached = { deps: buildDeps(outbound), outbound };
  }
  const { deps, outbound } = cached;
  const mark = outbound.replies.length;
  const adminMark = outbound.adminNotices.length;
  const started = Date.now();
  const result = await handleInbound(
    { channel: "WHATSAPP", externalAddress: from, providerSid: `SIM${Date.now()}${Math.random().toString(36).slice(2, 8)}`, body },
    deps,
  );
  return {
    result,
    replies: outbound.replies.slice(mark),
    adminNotices: outbound.adminNotices.slice(adminMark),
    latencyMs: Date.now() - started,
  };
}
