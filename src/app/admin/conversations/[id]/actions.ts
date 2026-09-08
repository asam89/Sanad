"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";

const schema = z.object({
  id: z.string().min(1),
  state: z.enum(["BOT", "HUMAN_TAKEOVER", "RESOLVE"]),
});

/** Admin-only (middleware-gated). The only writes the console performs on a conversation. */
export async function setState(form: FormData) {
  const { id, state } = schema.parse({ id: form.get("id"), state: form.get("state") });
  if (state === "RESOLVE") {
    await prisma.$transaction([
      prisma.escalation.updateMany({ where: { conversationId: id, resolvedAt: null }, data: { resolvedAt: new Date() } }),
      prisma.conversation.update({ where: { id }, data: { state: "BOT" } }),
    ]);
  } else {
    await prisma.conversation.update({ where: { id }, data: { state } });
  }
  revalidatePath(`/admin/conversations/${id}`);
  revalidatePath("/admin");
}
