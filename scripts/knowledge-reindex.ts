/** Re-embeds every published KnowledgeDoc. Run after editing docs/knowledge and re-seeding. */
import "./load-env";
import { env } from "@/lib/env";
import { getLLM } from "@/lib/llm";
import { reindex } from "@/lib/knowledge";
import { PrismaChunkStore } from "@/lib/knowledge/prisma-chunk-store";
import { prisma } from "@/lib/db";

async function main() {
  const llm = getLLM();
  const model = env().LLM_EMBED_MODEL ?? llm.name;
  const result = await reindex(new PrismaChunkStore(), llm, model);
  console.log(JSON.stringify({ event: "knowledge_reindexed", model, ...result }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
