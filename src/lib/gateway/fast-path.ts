import type { KnowledgeSearch } from "@/lib/knowledge";
import type { ProgramData } from "@/lib/tools";
import type { FastIntent } from "./intents";

/**
 * Data the fast path needs. Phase 2 implements this against the read-only
 * platform tools; until then StaticFastPathSource answers from config only.
 */
export interface FastPathSource {
  openPrograms(): Promise<{ name: string; price: string; when: string; venue: string; url: string }[]>;
  nextSessions(phone: string): Promise<{ program: string; when: string; venue: string }[]>;
  householdPayments(phone: string): Promise<{ child: string; program: string; status: "PAID" | "UNPAID" | "REFUNDED" }[]>;
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
  async householdPayments() {
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

/** Fast path over the read-only program tools; no LLM involved. */
export class ProgramFastPathSource implements FastPathSource {
  constructor(
    private readonly data: ProgramData,
    private readonly knowledge: KnowledgeSearch,
    private readonly regUrl: string,
  ) {}
  async openPrograms() {
    const rows = await this.data.openPrograms();
    return rows.map((p) => ({
      name: p.name,
      price: p.price,
      when: `${p.dayOfWeek}s ${p.timeOfDay} from ${p.startsOn}`,
      venue: p.venue,
      url: p.registrationUrl,
    }));
  }
  async nextSessions(phone: string) {
    const regs = await this.data.registrationsForPhone(phone.replace(/^whatsapp:/, ""));
    return regs
      .filter((r) => r.nextSession)
      .map((r) => ({ program: `${r.childFirstName} — ${r.program}`, when: r.nextSession!, venue: r.venue }));
  }
  async householdPayments(phone: string) {
    const regs = await this.data.registrationsForPhone(phone.replace(/^whatsapp:/, ""));
    return regs.map((r) => ({ child: r.childFirstName, program: r.program, status: r.paymentStatus }));
  }
  async venueSummary() {
    const venues = await this.data.venues();
    if (venues.length === 0) return null;
    return venues
      .map((v) => [`${v.name}: ${v.address}`, v.parking && `Parking: ${v.parking}`, v.accessNotes].filter(Boolean).join("\n"))
      .join("\n\n");
  }
  registrationUrl() {
    return this.regUrl;
  }
  async refundPolicySummary() {
    const hits = await this.knowledge.search("refund withdrawal policy", 1, 0.3);
    if (hits.length === 0) return null;
    return `${hits[0].content.split("\n").slice(1).join("\n")}\n\n${HUMAN_HINT}`;
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
      const payments = await src.householdPayments(phone);
      if (payments.length === 0) {
        return `Payment is completed at checkout when you register: ${src.registrationUrl()}\nIf you have an outstanding balance, the team will send you a payment link. ${HUMAN_HINT}`;
      }
      const lines = payments.map((p) =>
        p.status === "PAID"
          ? `- ${p.child} — ${p.program}: paid in full`
          : p.status === "REFUNDED"
            ? `- ${p.child} — ${p.program}: refunded`
            : `- ${p.child} — ${p.program}: payment outstanding`,
      );
      const owes = payments.some((p) => p.status === "UNPAID");
      return `${lines.join("\n")}${owes ? `\n\nTo settle the balance, the team can send you a payment link. ${HUMAN_HINT}` : ""}`;
    }
    case "refund": {
      const p = await src.refundPolicySummary();
      return p ?? `Refund and withdrawal requests are handled by the team directly. ${HUMAN_HINT}`;
    }
  }
}
