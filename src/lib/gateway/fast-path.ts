import type { FastIntent } from "./intents";

/**
 * Data the fast path needs. Phase 2 implements this against the read-only
 * platform tools; until then StaticFastPathSource answers from config only.
 */
export interface FastPathSource {
  openPrograms(): Promise<{ name: string; price: string; when: string; venue: string; url: string }[]>;
  nextSessions(phone: string): Promise<{ program: string; when: string; venue: string }[]>;
  venueSummary(): Promise<string | null>;
  registrationUrl(): string;
  refundPolicySummary(): Promise<string | null>;
}

export class StaticFastPathSource implements FastPathSource {
  constructor(private readonly regUrl: string) {}
  async openPrograms() {
    return [];
  }
  async nextSessions() {
    return [];
  }
  async venueSummary() {
    return null;
  }
  registrationUrl() {
    return this.regUrl;
  }
  async refundPolicySummary() {
    return null;
  }
}

const HUMAN_HINT = "Reply HUMAN any time to reach the FaezSports team.";

export async function fastReply(intent: FastIntent, phone: string, src: FastPathSource): Promise<string> {
  switch (intent) {
    case "register": {
      const programs = await src.openPrograms();
      if (programs.length === 0) return `You can register here: ${src.registrationUrl()}\n\n${HUMAN_HINT}`;
      const lines = programs.map((p) => `- ${p.name}: ${p.when}, ${p.price}\n  ${p.url}`);
      return `Programs open for registration:\n${lines.join("\n")}`;
    }
    case "cost": {
      const programs = await src.openPrograms();
      if (programs.length === 0) return `Current prices are listed on each program page: ${src.registrationUrl()}`;
      return programs.map((p) => `- ${p.name}: ${p.price}`).join("\n");
    }
    case "schedule": {
      const next = await src.nextSessions(phone);
      if (next.length === 0) {
        return `I could not find a registration linked to this number. Schedules are posted at ${src.registrationUrl()}\n\n${HUMAN_HINT}`;
      }
      return next.map((s) => `- ${s.program}: ${s.when} at ${s.venue}`).join("\n");
    }
    case "location": {
      const v = await src.venueSummary();
      return v ?? `Venue details are on each program page: ${src.registrationUrl()}`;
    }
    case "pay": {
      return `Payment is completed at checkout when you register: ${src.registrationUrl()}\nIf you have an outstanding balance, the team will send you a payment link. ${HUMAN_HINT}`;
    }
    case "refund": {
      const p = await src.refundPolicySummary();
      return p ?? `Refund and withdrawal requests are handled by the team directly. ${HUMAN_HINT}`;
    }
  }
}
