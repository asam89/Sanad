import { z } from "zod";

const schema = z.object({
  TWILIO_ACCOUNT_SID: z.string().min(1),
  TWILIO_AUTH_TOKEN: z.string().min(1),
  TWILIO_WHATSAPP_FROM: z.string().startsWith("whatsapp:"),
  SANAD_PUBLIC_URL: z.string().url(),
  SANAD_ADMIN_WHATSAPP: z.string().startsWith("whatsapp:").optional(),
  LLM_PROVIDER: z.enum(["local", "mock"]).default("local"),
  LLM_CHAT_URL: z.string().url().default("http://127.0.0.1:8081"),
  LLM_BATCH_URL: z.string().url().default("http://127.0.0.1:8082"),
  LLM_EMBED_URL: z.string().url().default("http://127.0.0.1:8083"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}
