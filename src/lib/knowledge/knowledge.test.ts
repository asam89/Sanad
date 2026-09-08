import { describe, expect, it } from "vitest";
import { MockProvider } from "@/lib/llm/mock";
import { chunkDocument, cosine, CosineKnowledgeSearch, reindex, type ChunkStore } from "./index";

class MemoryStore implements ChunkStore {
  chunks: { docId: string; ordinal: number; content: string; embedding: number[]; model: string }[] = [];
  constructor(private readonly docs: { id: string; slug: string; title: string; body: string }[]) {}
  async publishedDocs() {
    return this.docs;
  }
  async replaceChunks(docId: string, chunks: { ordinal: number; content: string; embedding: number[]; model: string }[]) {
    this.chunks = this.chunks.filter((c) => c.docId !== docId).concat(chunks.map((c) => ({ ...c, docId })));
  }
  async allChunks() {
    return this.chunks.map((c) => {
      const doc = this.docs.find((d) => d.id === c.docId)!;
      return { docSlug: doc.slug, title: doc.title, content: c.content, embedding: c.embedding };
    });
  }
}

describe("chunkDocument", () => {
  it("splits on paragraphs, prefixes the title, and respects the size cap", () => {
    const body = `# Refunds\n\n${"a".repeat(400)}\n\n${"b".repeat(400)}\n\n${"c".repeat(100)}`;
    const chunks = chunkDocument("Refunds", body);
    expect(chunks).toHaveLength(2);
    expect(chunks.every((c) => c.startsWith("Refunds\n"))).toBe(true);
    expect(chunks[1]).toContain("bbb");
    expect(chunks[1]).toContain("ccc");
  });

  it("splits oversize paragraphs on sentences", () => {
    const body = Array.from({ length: 20 }, (_, i) => `Sentence number ${i} is here and it keeps going for a while.`).join(" ");
    const chunks = chunkDocument("Long", body, 200);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.length <= 220)).toBe(true);
  });
});

describe("cosine", () => {
  it("handles identical, orthogonal and mismatched vectors", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine([1, 0], [1])).toBe(0);
  });
});

describe("reindex + CosineKnowledgeSearch", () => {
  it("embeds every published doc and retrieves the best match", async () => {
    const store = new MemoryStore([
      { id: "1", slug: "policy-refunds", title: "Refund Policy", body: "Full refund if you withdraw 7 days before the first session." },
      { id: "2", slug: "faq", title: "FAQ", body: "Bring indoor shoes and a water bottle." },
    ]);
    const llm = new MockProvider();
    const result = await reindex(store, llm, "mock");
    expect(result).toEqual({ docs: 2, chunks: 2 });
    const search = new CosineKnowledgeSearch(store, llm);
    // the mock embedding is position-sensitive, so query with the exact chunk text
    const hits = await search.search("Refund Policy\nFull refund if you withdraw 7 days before the first session.", 1, 0);
    expect(hits[0].docSlug).toBe("policy-refunds");
    expect(hits[0].score).toBeGreaterThan(0.5);
  });
});
