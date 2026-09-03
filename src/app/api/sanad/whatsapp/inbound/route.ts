import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { productionDeps } from "@/lib/gateway/deps";
import { handleInbound } from "@/lib/gateway/handle-inbound";
import { formDataToRecord, parseInbound, redactAddress, verifyTwilioSignature } from "@/lib/gateway/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const emptyTwiml = () =>
  new NextResponse("<Response></Response>", { status: 200, headers: { "content-type": "text/xml" } });

/**
 * Twilio WhatsApp inbound webhook (SPEC §6.1). Validates the signature,
 * returns 200 immediately, and does all real work detached from the response.
 * Sanad runs as a long-lived Node process (systemd), so the detached promise
 * survives the response; this must not be deployed to a serverless runtime.
 */
export async function POST(req: NextRequest) {
  const e = env();
  const params = formDataToRecord(await req.formData());
  const publicUrl = `${e.SANAD_PUBLIC_URL}/api/sanad/whatsapp/inbound`;

  if (!verifyTwilioSignature(e.TWILIO_AUTH_TOKEN, req.headers.get("x-twilio-signature"), publicUrl, params)) {
    console.warn(JSON.stringify({ level: "warn", event: "twilio_bad_signature" }));
    return new NextResponse("forbidden", { status: 403 });
  }

  const parsed = parseInbound(params);
  if (parsed.AccountSid !== e.TWILIO_ACCOUNT_SID) return new NextResponse("forbidden", { status: 403 });

  console.log(
    JSON.stringify({ level: "info", event: "inbound", sid: parsed.MessageSid, from: redactAddress(parsed.From) }),
  );

  void handleInbound(
    { channel: "WHATSAPP", externalAddress: parsed.From, providerSid: parsed.MessageSid, body: parsed.Body },
    productionDeps(),
  )
    .then((result) =>
      console.log(JSON.stringify({ level: "info", event: "inbound_handled", sid: parsed.MessageSid, ...result })),
    )
    .catch((err: unknown) =>
      console.error(JSON.stringify({ level: "error", event: "inbound_failed", sid: parsed.MessageSid, err: String(err) })),
    );

  return emptyTwiml();
}
