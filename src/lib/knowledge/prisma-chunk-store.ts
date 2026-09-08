import { prisma } from "@/lib/db";
import type { ChunkStore } from "./index";

export class PrismaChunkStore implements ChunkStore {
  publishedDocs() {
    return prisma.knowledgeDoc.findMany({
      where: { isPublished: true },
      select: { id: true, slug: true, title: true, body: true },
    });
  }

  async replaceChunks(docId: string, chunks: { ordinal: number; content: string; embedding: number[]; model: string }[]) {
    await prisma.$transaction([
      prisma.knowledgeChunk.deleteMany({ where: { docId } }),
      prisma.knowledgeChunk.createMany({ data: chunks.map((c) => ({ ...c, docId })) }),
    ]);
  }

  async allChunks() {
    const rows = await prisma.knowledgeChunk.findMany({
      where: { doc: { isPublished: true } },
      select: { content: true, embedding: true, doc: { select: { slug: true, title: true } } },
    });
    return rows.map((r) => ({
      docSlug: r.doc.slug,
      title: r.doc.title,
      content: r.content,
      embedding: Array.isArray(r.embedding) ? (r.embedding as number[]) : null,
    }));
  }
}
