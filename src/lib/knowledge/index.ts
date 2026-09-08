import type { LLMProvider } from "@/lib/llm/provider";

export interface KnowledgeHit {
  docSlug: string;
  title: string;
  content: string;
  score: number;
}

/** Store seam so retrieval is unit-testable without Postgres. */
export interface ChunkStore {
  publishedDocs(): Promise<{ id: string; slug: string; title: string; body: string }[]>;
  replaceChunks(docId: string, chunks: { ordinal: number; content: string; embedding: number[]; model: string }[]): Promise<void>;
  allChunks(): Promise<{ docSlug: string; title: string; content: string; embedding: number[] | null }[]>;
}

/** Paragraph-first chunking, ~600 chars, keeps the doc title in every chunk for context. */
export function chunkDocument(title: string, body: string, maxChars = 600): string[] {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.replace(/^#+\s*/, "").trim())
    .filter((p) => p.length > 0 && p !== title);
  const chunks: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if (current && current.length + p.length + 1 > maxChars) {
      chunks.push(current);
      current = "";
    }
    if (p.length > maxChars) {
      if (current) chunks.push(current), (current = "");
      for (const sentence of p.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [p]) {
        if (current.length + sentence.length > maxChars && current) {
          chunks.push(current.trim());
          current = "";
        }
        current += sentence;
      }
      continue;
    }
    current = current ? `${current}\n${p}` : p;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.map((c) => `${title}\n${c}`);
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export async function reindex(store: ChunkStore, llm: LLMProvider, model: string): Promise<{ docs: number; chunks: number }> {
  let total = 0;
  const docs = await store.publishedDocs();
  for (const doc of docs) {
    const texts = chunkDocument(doc.title, doc.body);
    const vectors = await llm.embed(texts);
    await store.replaceChunks(
      doc.id,
      texts.map((content, ordinal) => ({ ordinal, content, embedding: vectors[ordinal], model })),
    );
    total += texts.length;
  }
  return { docs: docs.length, chunks: total };
}

export interface KnowledgeSearch {
  search(query: string, k?: number, minScore?: number): Promise<KnowledgeHit[]>;
}

/** In-process cosine ranking over every embedded chunk. Fine up to a few thousand chunks. */
export class CosineKnowledgeSearch implements KnowledgeSearch {
  constructor(
    private readonly store: ChunkStore,
    private readonly llm: LLMProvider,
  ) {}

  async search(query: string, k = 4, minScore = 0.5): Promise<KnowledgeHit[]> {
    const [qv] = await this.llm.embed([query]);
    const chunks = await this.store.allChunks();
    return chunks
      .filter((c) => c.embedding)
      .map((c) => ({ docSlug: c.docSlug, title: c.title, content: c.content, score: cosine(qv, c.embedding!) }))
      .filter((c) => c.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}
