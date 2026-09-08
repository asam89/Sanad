import { z } from "zod";

const schema = z.object({
  TWILIO_ACCOUNT_SID: z.string().min(1),
  TWILIO_AUTH_TOKEN: z.string().min(1),
  TWILIO_WHATSAPP_FROM: z.string().startsWith("whatsapp:"),
  SANAD_PUBLIC_URL: z.string().url(),
  SANAD_ADMIN_WHATSAPP: z.string().startsWith("whatsapp:").optional(),
  /** Basic-auth password for /admin. Unset = admin disabled. */
  SANAD_ADMIN_PASSWORD: z.string().min(4).optional(),
  LLM_PROVIDER: z.enum(["local", "mock"]).default("local"),
  LLM_CHAT_URL: z.string().url().default("http://127.0.0.1:8081"),
  LLM_BATCH_URL: z.string().url().optional(),
  LLM_EMBED_URL: z.string().url().default("http://127.0.0.1:8083"),
  LLM_CHAT_MODEL: z.string().optional(),
  LLM_BATCH_MODEL: z.string().optional(),
  LLM_EMBED_MODEL: z.string().optional(),
  FAEZSPORTS_REGISTRATION_URL: z.string().url().default("https://faezsports.com"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}
