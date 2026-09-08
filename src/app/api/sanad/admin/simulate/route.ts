import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { simulateInbound } from "@/lib/gateway/simulator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  from: z.string().regex(/^\+\d{8,15}$/, "E.164 phone, e.g. +14165550100"),
  body: z.string().min(1).max(1600),
});

/** Admin-only (basic auth via middleware). Sends a synthetic WhatsApp message through the real pipeline. */
export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "bad request" }, { status: 400 });
  try {
    const turn = await simulateInbound(`whatsapp:${parsed.data.from}`, parsed.data.body);
    return NextResponse.json(turn);
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "simulate_failed", err: String(err) }));
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
