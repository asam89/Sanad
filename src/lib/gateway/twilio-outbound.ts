import twilio from "twilio";
import type { Channel } from "@prisma/client";
import { env } from "@/lib/env";
import type { Outbound } from "./handle-inbound";
import { redactAddress } from "./twilio";

export class TwilioOutbound implements Outbound {
  private readonly client = twilio(env().TWILIO_ACCOUNT_SID, env().TWILIO_AUTH_TOKEN);

  async send(to: string, channel: Channel, body: string) {
    if (channel !== "WHATSAPP") throw new Error(`channel ${channel} not wired yet`);
    const res = await this.client.messages.create({ from: env().TWILIO_WHATSAPP_FROM, to, body });
    console.log(JSON.stringify({ level: "info", event: "outbound_sent", to: redactAddress(to), sid: res.sid }));
  }

  async notifyAdmin(text: string) {
    const admin = env().SANAD_ADMIN_WHATSAPP;
    if (!admin) {
      console.warn(JSON.stringify({ level: "warn", event: "admin_notify_skipped", reason: "SANAD_ADMIN_WHATSAPP unset" }));
      return;
    }
    await this.client.messages.create({ from: env().TWILIO_WHATSAPP_FROM, to: admin, body: text });
  }
}
