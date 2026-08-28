import db from "../db.server";

const MAX_DOCUMENT_CHARS = 50_000;

export interface CreateDocumentInput {
  agentId: string | null; // null = shared across every agent
  title: string;
  content: string;
}

/** Stores a merchant-uploaded document (paste or plain-text file) as a RAG source. */
export async function createDocument(shop: string, input: CreateDocumentInput) {
  const title = input.title.trim();
  const content = input.content.trim().slice(0, MAX_DOCUMENT_CHARS);
  if (!title) throw new Error("Title is required");
  if (!content) throw new Error("Document content is required");

  if (input.agentId) {
    const agent = await db.agent.findUniqueOrThrow({ where: { id: input.agentId } });
    if (agent.shop !== shop) throw new Response("Not found", { status: 404 });
  }

  const document = await db.document.create({
    data: { shop, agentId: input.agentId, title, content },
  });

  await db.auditLog.create({
    data: {
      shop,
      agentId: input.agentId,
      action: "document.uploaded",
      detail: JSON.stringify({ title, length: content.length }),
    },
  });

  return document;
}

export async function deleteDocument(shop: string, documentId: string) {
  const document = await db.document.findUniqueOrThrow({ where: { id: documentId } });
  if (document.shop !== shop) throw new Response("Not found", { status: 404 });
  await db.document.delete({ where: { id: documentId } });
  await db.auditLog.create({
    data: {
      shop,
      agentId: document.agentId,
      action: "document.deleted",
      detail: JSON.stringify({ title: document.title }),
    },
  });
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/**
 * Naive keyword-overlap retrieval: scores each candidate document by how many
 * distinct query words it contains, returns the top matches. This is a
 * deliberate simplification of real RAG (no embeddings, no vector DB) - it
 * still does *selective* retrieval rather than dumping every document into
 * the prompt, which is the property that actually matters at this scale.
 * Swap this function for a vector-similarity lookup later without touching
 * callers or the schema.
 */
export async function retrieveRelevantDocuments(
  shop: string,
  agentId: string,
  query: string,
  limit = 3,
) {
  const documents = await db.document.findMany({
    where: { shop, OR: [{ agentId }, { agentId: null }] },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  if (documents.length === 0) return [];

  const queryWords = new Set(tokenize(query));
  if (queryWords.size === 0) return documents.slice(0, limit);

  const scored = documents.map((doc) => {
    const docWords = new Set(tokenize(`${doc.title} ${doc.content}`));
    let overlap = 0;
    for (const w of queryWords) if (docWords.has(w)) overlap += 1;
    return { doc, score: overlap };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.doc);
}
