import { describe, expect, it } from "vitest";
import { MockProvider } from "@/lib/llm/mock";
import type { KnowledgeSearch } from "@/lib/knowledge";
import { ToolRegistry, type ProgramData } from "@/lib/tools";
import { ToolAgent, type HistorySource } from "./answer";

const program = {
  slug: "fall-girls",
  name: "Fall Girls Basketball",
  sport: "Basketball",
  ageRange: "9-12",
  dayOfWeek: "Saturday",
  timeOfDay: "10:00-11:30",
  price: "$180 CAD",
  spotsLeft: 5,
  startsOn: "September 12",
  venue: "Community Gym",
  registrationUrl: "https://faezsports.com/p/fall-girls",
};

class FakeData implements ProgramData {
  regCallsWithPhone: string[] = [];
  async openPrograms() {
    return [program];
  }
  async programDetails(slug: string) {
    return slug === program.slug ? { ...program, venueAddress: "1 Main St", parking: null, accessNotes: null } : null;
  }
  async upcomingSessions() {
    return [];
  }
  async registrationsForPhone(phone: string) {
    this.regCallsWithPhone.push(phone);
    return phone === "+14165550100"
      ? [{ childFirstName: "Maya", program: program.name, programSlug: program.slug, paymentStatus: "PAID" as const, nextSession: "Sat Sep 12, 10:00 a.m.", venue: "Community Gym" }]
      : [];
  }
  async venues() {
    return [];
  }
}

const knowledge: KnowledgeSearch = {
  async search(q: string) {
    return q.includes("refund") ? [{ docSlug: "policy-refunds", title: "Refunds", content: "Full refund 7 days before.", score: 0.9 }] : [];
  },
};

const history: HistorySource = { async recent() { return []; } };
const inbound = (body: string, from = "whatsapp:+14165550100") =>
  ({ channel: "WHATSAPP" as const, externalAddress: from, providerSid: "SM1", body });

describe("ToolRegistry", () => {
  it("validates arguments with Zod and rejects unknown tools", async () => {
    const reg = new ToolRegistry(new FakeData(), knowledge);
    expect(JSON.parse(await reg.execute("nope", "{}", { phone: null }))).toEqual({ error: "unknown tool nope" });
    expect(JSON.parse(await reg.execute("get_program_details", "{}", { phone: null }))).toMatchObject({ error: "invalid arguments" });
    expect(JSON.parse(await reg.execute("get_program_details", "not json", { phone: null }))).toMatchObject({ error: "arguments were not valid JSON" });
    expect(JSON.parse(await reg.execute("list_open_programs", "", { phone: null }))).toEqual([program]);
  });

  it("scopes get_my_registrations to the conversation phone, ignoring model-supplied args", async () => {
    const data = new FakeData();
    const reg = new ToolRegistry(data, knowledge);
    const out = await reg.execute("get_my_registrations", '{"phone":"+19999999999"}', { phone: "+14165550100" });
    expect(JSON.parse(out)).toMatchObject({ error: "invalid arguments" });
    const ok = await reg.execute("get_my_registrations", "{}", { phone: "+14165550100" });
    expect(JSON.parse(ok)[0].childFirstName).toBe("Maya");
    expect(data.regCallsWithPhone).toEqual(["+14165550100"]);
  });
});

describe("ToolAgent", () => {
  it("runs the tool loop and returns a grounded answer", async () => {
    const llm = new MockProvider([
      { toolCalls: [{ id: "c1", name: "get_my_registrations", arguments: "{}" }] },
      { content: "Maya's next session is Sat Sep 12 at 10:00 a.m. at Community Gym." },
    ]);
    const agent = new ToolAgent(llm, new ToolRegistry(new FakeData(), knowledge), history, knowledge);
    const reply = await agent.answer("c1", inbound("when is my daughter's next practice?"));
    expect(reply).toContain("Sep 12");
    expect(llm.calls).toHaveLength(2);
    const toolMsg = llm.calls[1].messages.find((m) => m.role === "tool");
    expect(toolMsg?.content).toContain("Maya");
    expect(llm.calls[0].tools?.map((t) => t.name)).toContain("search_knowledge");
  });

  it("injects retrieved knowledge as CONTEXT and treats it as grounding", async () => {
    const llm = new MockProvider([{ content: "Full refund if you withdraw 7 days before the first session." }]);
    const agent = new ToolAgent(llm, new ToolRegistry(new FakeData(), knowledge), history, knowledge);
    const reply = await agent.answer("c1", inbound("what is the refund policy?"));
    expect(reply).toContain("Full refund");
    expect(llm.calls[0].messages[0].content).toContain("CONTEXT:\n[1] Full refund 7 days before.");
  });

  it("returns null (escalate) when the model answers without any tool result", async () => {
    const llm = new MockProvider([{ content: "It costs $50." }]);
    const agent = new ToolAgent(llm, new ToolRegistry(new FakeData(), knowledge), history, knowledge);
    expect(await agent.answer("c1", inbound("how much is it"))).toBeNull();
  });

  it("returns null when the model only produced failing tool calls", async () => {
    const llm = new MockProvider([
      { toolCalls: [{ id: "c1", name: "get_program_details", arguments: '{"slug":"nope"}' }] },
      { content: "Program nope costs $10" },
    ]);
    const agent = new ToolAgent(llm, new ToolRegistry(new FakeData(), knowledge), history, knowledge);
    expect(await agent.answer("c1", inbound("tell me about nope"))).toBeNull();
  });

  it("stops after maxToolRounds", async () => {
    const loop = { toolCalls: [{ id: "x", name: "list_open_programs", arguments: "{}" }] };
    const llm = new MockProvider([loop, loop, loop, loop, loop, loop]);
    const agent = new ToolAgent(llm, new ToolRegistry(new FakeData(), knowledge), history, knowledge, { maxToolRounds: 2 });
    expect(await agent.answer("c1", inbound("loop"))).toBeNull();
    expect(llm.calls).toHaveLength(3);
  });

  it("includes recent history and the current time in the prompt", async () => {
    const llm = new MockProvider([{ content: "" }]);
    const hist: HistorySource = { async recent() { return [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }]; } };
    const agent = new ToolAgent(llm, new ToolRegistry(new FakeData(), knowledge), hist, knowledge, { now: () => new Date("2026-09-01T12:00:00Z") });
    await agent.answer("c1", inbound("q"));
    const roles = llm.calls[0].messages.map((m) => m.role);
    expect(roles).toEqual(["system", "user", "assistant", "user"]);
    expect(llm.calls[0].messages[0].content).toContain("2026-09-01");
  });
});
