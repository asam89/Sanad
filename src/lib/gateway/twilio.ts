import { validateRequest } from "twilio";
import { z } from "zod";

/** Fields Twilio posts for an inbound WhatsApp message (form-encoded). */
export const inboundSchema = z.object({
  MessageSid: z.string().min(1),
  AccountSid: z.string().min(1),
  From: z.string().startsWith("whatsapp:"),
  To: z.string().startsWith("whatsapp:"),
  Body: z.string().default(""),
  NumMedia: z.coerce.number().int().min(0).default(0),
  ProfileName: z.string().optional(),
  WaId: z.string().optional(),
});

export type InboundMessage = z.infer<typeof inboundSchema>;

export function parseInbound(params: Record<string, string>): InboundMessage {
  return inboundSchema.parse(params);
}

/**
 * Validates X-Twilio-Signature against the public URL Twilio actually called.
 * Behind nginx the request URL is loopback, so the caller must pass the public URL.
 */
export function verifyTwilioSignature(
  authToken: string,
  signature: string | null,
  publicUrl: string,
  params: Record<string, string>,
): boolean {
  if (!signature) return false;
  return validateRequest(authToken, signature, publicUrl, params);
}

export function formDataToRecord(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  fd.forEach((v, k) => {
    if (typeof v === "string") out[k] = v;
  });
  return out;
}

/** Redact for logs: keep last 4 digits only (SPEC §11). */
export function redactAddress(addr: string): string {
  const digits = addr.replace(/\D/g, "");
  return `${addr.split(":")[0]}:***${digits.slice(-4)}`;
}
