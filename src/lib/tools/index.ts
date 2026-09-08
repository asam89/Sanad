import { z } from "zod";
import type { ToolDefinition } from "@/lib/llm/provider";
import type { KnowledgeSearch } from "@/lib/knowledge";

/**
 * Read-only tool layer the model can call (SPEC §5.1). Every tool is a SELECT.
 * The household phone comes from the conversation, never from the model, so
 * one parent can never read another's registrations (SPEC §5.2).
 */
export interface ProgramData {
  openPrograms(): Promise<ProgramSummary[]>;
  programDetails(slug: string): Promise<ProgramDetails | null>;
  upcomingSessions(slug: string, limit: number): Promise<SessionInfo[]>;
  registrationsForPhone(phoneE164: string): Promise<HouseholdRegistration[]>;
  venues(): Promise<VenueInfo[]>;
}

export interface ProgramSummary {
  slug: string;
  name: string;
  sport: string;
  ageRange: string;
  dayOfWeek: string;
  timeOfDay: string;
  price: string;
  spotsLeft: number;
  startsOn: string;
  venue: string;
  registrationUrl: string;
}
export interface ProgramDetails extends ProgramSummary {
  venueAddress: string;
  parking: string | null;
  accessNotes: string | null;
}
export interface SessionInfo {
  program: string;
  startsAt: string;
  endsAt: string;
  venue: string;
  note: string | null;
}
export interface HouseholdRegistration {
  childFirstName: string;
  program: string;
  programSlug: string;
  paymentStatus: "PAID" | "UNPAID" | "REFUNDED";
  nextSession: string | null;
  venue: string;
}
export interface VenueInfo {
  name: string;
  address: string;
  parking: string | null;
  accessNotes: string | null;
}

export interface ToolContext {
  /** E.164 phone of the conversation, or null for non-phone channels. */
  phone: string | null;
}

interface ToolSpec<A> {
  def: ToolDefinition;
  args: z.ZodType<A>;
  run(args: A, ctx: ToolContext): Promise<unknown>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolSpec<unknown>>();

  constructor(data: ProgramData, knowledge: KnowledgeSearch) {
    this.register({
      def: {
        name: "list_open_programs",
        description: "List programs currently open for registration with price, schedule, venue and spots left.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
      args: z.object({}).strict(),
      run: () => data.openPrograms(),
    });
    this.register({
      def: {
        name: "get_program_details",
        description: "Full details for one program by slug (from list_open_programs), including venue address and parking.",
        parameters: {
          type: "object",
          properties: { slug: { type: "string" } },
          required: ["slug"],
          additionalProperties: false,
        },
      },
      args: z.object({ slug: z.string().min(1) }).strict(),
      run: async (a) => (await data.programDetails(a.slug)) ?? { error: "unknown program" },
    });
    this.register({
      def: {
        name: "get_upcoming_sessions",
        description: "Next sessions (date/time/venue) for a program slug.",
        parameters: {
          type: "object",
          properties: { slug: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 10 } },
          required: ["slug"],
          additionalProperties: false,
        },
      },
      args: z.object({ slug: z.string().min(1), limit: z.number().int().min(1).max(10).optional() }).strict(),
      run: (a) => data.upcomingSessions(a.slug, a.limit ?? 3),
    });
    this.register({
      def: {
        name: "get_my_registrations",
        description:
          "Registrations, payment status and next session for the family sending this message. Takes no arguments; the phone number is implied.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
      args: z.object({}).strict(),
      run: async (_a, ctx) => (ctx.phone ? data.registrationsForPhone(ctx.phone) : []),
    });
    this.register({
      def: {
        name: "get_venues",
        description: "Venue addresses, parking and access notes.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
      args: z.object({}).strict(),
      run: () => data.venues(),
    });
    this.register({
      def: {
        name: "search_knowledge",
        description: "Search FaezSports policies, FAQ and rules (refunds, what to bring, cancellations, conduct, payment).",
        parameters: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
          additionalProperties: false,
        },
      },
      args: z.object({ query: z.string().min(1).max(300) }).strict(),
      run: (a) => knowledge.search(a.query),
    });
  }

  private register<A>(spec: ToolSpec<A>) {
    this.tools.set(spec.def.name, spec as ToolSpec<unknown>);
  }

  definitions(): ToolDefinition[] {
    return [...this.tools.values()].map((t) => t.def);
  }

  /** Validates arguments with Zod, runs the tool, and returns a JSON string for the model. */
  async execute(name: string, rawArgs: string, ctx: ToolContext): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) return JSON.stringify({ error: `unknown tool ${name}` });
    let parsedJson: unknown;
    try {
      parsedJson = rawArgs.trim() ? JSON.parse(rawArgs) : {};
    } catch {
      return JSON.stringify({ error: "arguments were not valid JSON" });
    }
    const args = tool.args.safeParse(parsedJson);
    if (!args.success) return JSON.stringify({ error: "invalid arguments", issues: args.error.issues.map((i) => i.message) });
    return JSON.stringify(await tool.run(args.data, ctx));
  }
}
