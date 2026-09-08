import type { AiPath, NormalisedInbound } from "@/lib/gateway/handle-inbound";
import type { KnowledgeSearch } from "@/lib/knowledge";
import type { ChatMessage, LLMProvider } from "@/lib/llm/provider";
import type { ToolRegistry } from "@/lib/tools";

export interface HistorySource {
  /** Most recent messages in the thread, oldest first, excluding the current inbound. */
  recent(conversationId: string, limit: number): Promise<{ role: "user" | "assistant"; content: string }[]>;
}

export interface AgentOptions {
  /** Hard budget for the whole answer, tool rounds included (SPEC §3.3 → 45 s). */
  timeoutMs?: number;
  maxToolRounds?: number;
  historyTurns?: number;
  now?: () => Date;
  log?: (event: Record<string, unknown>) => void;
}

export const SYSTEM_PROMPT = `You are Sanad, the FaezSports assistant on WhatsApp. FaezSports runs youth sports programs in Scarborough / Toronto.

Rules:
- Answer ONLY from the CONTEXT block and tool results. If neither contains the answer, say you will pass the question to the FaezSports team. Never guess prices, dates, addresses or policies.
- The CONTEXT block holds FaezSports policy/FAQ passages already retrieved for this question. Use tools for live data: programs, prices, sessions, venues, and the family's registrations. For anything about "my child", "my registration", "my payment" or "our next session", call get_my_registrations.
- Keep replies short and WhatsApp-friendly: 1-4 sentences or a short bulleted list. No markdown headings. Plain text only.
- Never ask for or repeat full phone numbers, emails or other families' details. Only talk about the registrations returned by get_my_registrations.
- You cannot register, cancel, refund or change anything. For those, tell the parent the team will follow up, or send the registration link.
- Be warm and direct. If the parent writes in another language, answer in that language.`;

/**
 * Retrieval-first tool-calling loop over the local model. Knowledge hits for
 * the question are injected up front (small models are unreliable at choosing
 * to search); live data comes from tools. Returns null when the answer is not
 * grounded in retrieval or at least one successful tool result so the gateway
 * escalates (SPEC §3.2).
 */
export class ToolAgent implements AiPath {
  private readonly timeoutMs: number;
  private readonly maxToolRounds: number;
  private readonly historyTurns: number;
  private readonly now: () => Date;
  private readonly log: (event: Record<string, unknown>) => void;

  constructor(
    private readonly llm: LLMProvider,
    private readonly tools: ToolRegistry,
    private readonly history: HistorySource,
    private readonly knowledge: KnowledgeSearch,
    opts: AgentOptions = {},
  ) {
    this.timeoutMs = opts.timeoutMs ?? 45_000;
    this.maxToolRounds = opts.maxToolRounds ?? 4;
    this.historyTurns = opts.historyTurns ?? 6;
    this.now = opts.now ?? (() => new Date());
    this.log = opts.log ?? (() => {});
  }

  async answer(conversationId: string, msg: NormalisedInbound): Promise<string | null> {
    const deadline = Date.now() + this.timeoutMs;
    const remaining = () => deadline - Date.now();
    const phone = msg.channel === "WHATSAPP" ? msg.externalAddress.replace(/^whatsapp:/, "") : null;

    const [past, hits] = await Promise.all([
      this.history.recent(conversationId, this.historyTurns),
      this.knowledge.search(msg.body, 3).catch((err: unknown) => {
        this.log({ event: "agent_retrieval_failed", conversationId, err: String(err) });
        return [];
      }),
    ]);
    const context = hits.length
      ? hits.map((h, i) => `[${i + 1}] ${h.content}`).join("\n\n")
      : "(no policy passages matched this question)";
    const messages: ChatMessage[] = [
      { role: "system", content: `${SYSTEM_PROMPT}\n\nCurrent date/time: ${this.now().toISOString()}\n\nCONTEXT:\n${context}` },
      ...past.map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
      { role: "user", content: msg.body },
    ];

    let grounded = hits.length > 0;
    this.log({ event: "agent_retrieval", conversationId, hits: hits.length, top: hits[0]?.score });
    let toolErrors = 0;
    const started = Date.now();
    let ttfbMs: number | undefined;

    for (let round = 0; round <= this.maxToolRounds; round++) {
      if (remaining() <= 0) {
        this.log({ event: "agent_timeout", conversationId, round });
        return null;
      }
      const res = await this.llm.chatWithTools(messages, this.tools.definitions(), {
        timeoutMs: remaining(),
        maxTokens: 350,
      });
      ttfbMs ??= res.ttfbMs;

      if (res.toolCalls.length === 0) {
        const content = res.content.trim();
        this.log({
          event: "agent_answer",
          conversationId,
          grounded,
          rounds: round,
          ttfbMs,
          latencyMs: Date.now() - started,
        });
        if (!grounded || !content) return null;
        return content;
      }

      messages.push({ role: "assistant", content: res.content, toolCalls: res.toolCalls });
      for (const call of res.toolCalls) {
        const out = await this.tools.execute(call.name, call.arguments, { phone });
        const failed = out.startsWith('{"error"');
        if (failed) toolErrors++;
        else grounded = true;
        this.log({ event: "agent_tool", conversationId, tool: call.name, ok: !failed });
        messages.push({ role: "tool", content: out, toolCallId: call.id });
      }
      if (toolErrors >= 3) return null;
    }

    this.log({ event: "agent_max_rounds", conversationId });
    return null;
  }
}
