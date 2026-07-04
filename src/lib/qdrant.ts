import { QdrantClient } from "@qdrant/js-client-rest";
import { DEFAULT_EMBEDDING_DIMENSIONS } from "@/lib/env";

export type ChunkPayload = {
  knowledgeBaseId: string;
  fileId: string;
  filename: string;
  chunkIndex: number;
  text: string;
  source: string;
  sourceUrl?: string | null;
};

export type RetrievedChunk = {
  id: string;
  score: number;
  payload: ChunkPayload;
};

export function buildCollectionName(knowledgeBaseId: string) {
  return `kb_${knowledgeBaseId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

export function createQdrantClient(url: string, apiKey: string | null) {
  return new QdrantClient({
    url,
    apiKey: apiKey ?? undefined,
  });
}

export async function ensureCollection(
  client: QdrantClient,
  collectionName: string,
  vectorSize = DEFAULT_EMBEDDING_DIMENSIONS,
) {
  const collections = await client.getCollections();
  const exists = collections.collections.some(
    (collection) => collection.name === collectionName,
  );

  if (exists) {
    return;
  }

  await client.createCollection(collectionName, {
    vectors: {
      size: vectorSize,
      distance: "Cosine",
    },
  });
}

export async function upsertChunks(
  client: QdrantClient,
  collectionName: string,
  chunks: Array<{
    id: string;
    vector: number[];
    payload: ChunkPayload;
  }>,
) {
  if (!chunks.length) {
    return;
  }

  await client.upsert(collectionName, {
    wait: true,
    points: chunks.map((chunk) => ({
      id: chunk.id,
      vector: chunk.vector,
      payload: chunk.payload,
    })),
  });
}

export async function deleteFileChunks(
  client: QdrantClient,
  collectionName: string,
  fileId: string,
) {
  await client.delete(collectionName, {
    wait: true,
    filter: {
      must: [
        {
          key: "fileId",
          match: { value: fileId },
        },
      ],
    },
  });
}

export async function searchCollection(
  client: QdrantClient,
  collectionName: string,
  vector: number[],
  options?: {
    limit?: number;
    scoreThreshold?: number;
  },
): Promise<RetrievedChunk[]> {
  const results = await client.search(collectionName, {
    vector,
    limit: options?.limit ?? 8,
    score_threshold: options?.scoreThreshold,
    with_payload: true,
  });

  const chunks: RetrievedChunk[] = [];

  for (const result of results) {
    const payload = result.payload as Partial<ChunkPayload> | null | undefined;
    if (
      !payload?.knowledgeBaseId ||
      !payload.fileId ||
      !payload.filename ||
      typeof payload.chunkIndex !== "number" ||
      !payload.text
    ) {
      continue;
    }

    chunks.push({
      id: String(result.id),
      score: result.score ?? 0,
      payload: {
        knowledgeBaseId: payload.knowledgeBaseId,
        fileId: payload.fileId,
        filename: payload.filename,
        chunkIndex: payload.chunkIndex,
        text: payload.text,
        source: payload.source ?? "local",
        sourceUrl: payload.sourceUrl ?? null,
      },
    });
  }

  return chunks;
}
