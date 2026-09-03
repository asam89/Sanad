import { Prisma, type EscalationReason, type RoutePath } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { ConversationStore, NormalisedInbound, StoredConversation } from "./handle-inbound";

export class PrismaConversationStore implements ConversationStore {
  async recordInbound(msg: NormalisedInbound): Promise<StoredConversation | null> {
    const convo = await prisma.conversation.upsert({
      where: { channel_externalAddress: { channel: msg.channel, externalAddress: msg.externalAddress } },
      create: { channel: msg.channel, externalAddress: msg.externalAddress, lastInboundAt: new Date() },
      update: { lastInboundAt: new Date() },
    });

    const previous = await prisma.message.findFirst({
      where: { conversationId: convo.id, direction: "INBOUND" },
      orderBy: { createdAt: "desc" },
      select: { body: true },
    });

    try {
      await prisma.message.create({
        data: { conversationId: convo.id, direction: "INBOUND", body: msg.body, providerSid: msg.providerSid },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
      throw e;
    }

    return { id: convo.id, state: convo.state, optedOut: convo.optedOut, previousInbound: previous?.body };
  }

  async recordOutbound(conversationId: string, body: string, meta: { routePath: RoutePath; intent?: string }) {
    await prisma.message.create({
      data: { conversationId, direction: "OUTBOUND", body, routePath: meta.routePath, intent: meta.intent },
    });
  }

  async setOptedOut(conversationId: string, optedOut: boolean) {
    await prisma.conversation.update({ where: { id: conversationId }, data: { optedOut } });
  }

  async escalate(conversationId: string, reason: EscalationReason, excerpt: string) {
    await prisma.$transaction([
      prisma.escalation.create({ data: { conversationId, reason, excerpt } }),
      prisma.conversation.update({ where: { id: conversationId }, data: { state: "ESCALATED" } }),
    ]);
  }
}
