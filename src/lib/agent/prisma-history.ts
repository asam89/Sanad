import { prisma } from "@/lib/db";
import type { HistorySource } from "./answer";

export class PrismaHistory implements HistorySource {
  async recent(conversationId: string, limit: number) {
    const rows = await prisma.message.findMany({
      // canned replies (STOP ack, throttle, escalation) add nothing for the model
      where: { conversationId, OR: [{ direction: "INBOUND" }, { routePath: { in: ["FAST", "AI"] } }] },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      select: { direction: true, body: true },
    });
    // newest row is the inbound being answered right now
    return rows
      .slice(1)
      .reverse()
      .map((m) => ({ role: m.direction === "INBOUND" ? ("user" as const) : ("assistant" as const), content: m.body }));
  }
}
