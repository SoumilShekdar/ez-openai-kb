import { ImportSource, KeyMode, KbVisibility, UsageEventType } from "@prisma/client";
import type { QdrantClient } from "@qdrant/js-client-rest";
import type OpenAI from "openai";
import { ApiError } from "@/lib/api";
import { validateSupportedFile } from "@/lib/file-support";
import { prisma } from "@/lib/prisma";
import {
  buildCollectionName,
  deleteFileChunks,
  ensureCollection,
  upsertChunks,
} from "@/lib/qdrant";
import { DEFAULT_EMBEDDING_MODEL } from "@/lib/env";

export async function createKnowledgeBase(
  name: string,
  description: string | null,
  ownerId: string,
  qdrantClient: QdrantClient,
  visibility: KbVisibility = KbVisibility.PRIVATE,
) {
  const kb = await prisma.knowledgeBase.create({
    data: {
      name,
      description,
      qdrantCollectionName: `kb_pending_${Date.now()}`,
      visibility,
      ownerId,
    },
  });

  const collectionName = buildCollectionName(kb.id);
  await ensureCollection(qdrantClient, collectionName);

  return prisma.knowledgeBase.update({
    where: { id: kb.id },
    data: {
      qdrantCollectionName: collectionName,
    },
  });
}

export async function requireKnowledgeBase(id: string) {
  const kb = await prisma.knowledgeBase.findUnique({
    where: { id },
  });

  if (!kb) {
    throw new ApiError(404, "Knowledge base not found.");
  }

  return kb;
}

export async function recordUsageEvent({
  sessionId,
  eventType,
  keyMode,
  knowledgeBaseId,
}: {
  sessionId: string;
  eventType: UsageEventType;
  keyMode: KeyMode;
  knowledgeBaseId?: string;
}) {
  await prisma.usageEvent.create({
    data: {
      sessionId,
      eventType,
      keyMode,
      knowledgeBaseId,
    },
  });
}

export function buildFileAttributes({
  source,
  sourceUrl,
}: {
  source: ImportSource;
  sourceUrl?: string | null;
}) {
  return {
    source: source.toLowerCase(),
    ...(sourceUrl ? { source_url: sourceUrl.slice(0, 512) } : {}),
  };
}

export function normalizeSourceUrl(url: string) {
  try {
    const parsed = new URL(url.trim());
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.trim().replace(/\/$/, "");
  }
}

export async function findExistingKnowledgeFileBySourceUrl(
  knowledgeBaseId: string,
  sourceUrl: string,
) {
  const normalized = normalizeSourceUrl(sourceUrl);
  const files = await prisma.knowledgeFile.findMany({
    where: {
      knowledgeBaseId,
      sourceUrl: {
        not: null,
      },
    },
  });

  return (
    files.find((file) => file.sourceUrl && normalizeSourceUrl(file.sourceUrl) === normalized) ??
    null
  );
}

export async function saveKnowledgeFile({
  knowledgeBaseId,
  originalName,
  importSource,
  sourceUrl,
  status,
  bytes,
  mimeType,
  chunkCount,
  attributes,
}: {
  knowledgeBaseId: string;
  originalName: string;
  importSource: ImportSource;
  sourceUrl?: string | null;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  bytes?: number | null;
  mimeType?: string | null;
  chunkCount?: number;
  attributes?: Record<string, string | number | boolean> | null;
}) {
  validateSupportedFile(originalName, mimeType);

  return prisma.knowledgeFile.create({
    data: {
      knowledgeBaseId,
      originalName,
      importSource,
      sourceUrl: sourceUrl ?? null,
      status,
      bytes: bytes ?? null,
      mimeType: mimeType ?? null,
      chunkCount: chunkCount ?? 0,
      attributesJson: attributes ? JSON.stringify(attributes) : null,
    },
  });
}

export async function updateKnowledgeFileStatus(
  fileId: string,
  data: {
    status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
    chunkCount?: number;
  },
) {
  return prisma.knowledgeFile.update({
    where: { id: fileId },
    data,
  });
}

export async function removeKnowledgeFileVectors({
  qdrantClient,
  collectionName,
  fileId,
}: {
  qdrantClient: QdrantClient;
  collectionName: string;
  fileId: string;
}) {
  await deleteFileChunks(qdrantClient, collectionName, fileId);
}

export async function indexParsedDocument({
  openaiClient,
  qdrantClient,
  knowledgeBaseId,
  collectionName,
  fileId,
  filename,
  importSource,
  sourceUrl,
  text,
  embeddingModel = DEFAULT_EMBEDDING_MODEL,
}: {
  openaiClient: OpenAI;
  qdrantClient: QdrantClient;
  knowledgeBaseId: string;
  collectionName: string;
  fileId: string;
  filename: string;
  importSource: ImportSource;
  sourceUrl?: string | null;
  text: string;
  embeddingModel?: string;
}) {
  const { chunkText } = await import("@/lib/chunking");
  const { embedTexts } = await import("@/lib/embeddings");

  const chunks = chunkText(text);
  if (!chunks.length) {
    throw new ApiError(400, `No indexable text was found in "${filename}".`);
  }

  const vectors = await embedTexts(
    openaiClient,
    chunks.map((chunk) => chunk.text),
    embeddingModel,
  );

  await upsertChunks(
    qdrantClient,
    collectionName,
    chunks.map((chunk, index) => ({
      id: crypto.randomUUID(),
      vector: vectors[index] ?? [],
      payload: {
        knowledgeBaseId,
        fileId,
        filename,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        source: importSource.toLowerCase(),
        sourceUrl: sourceUrl ?? null,
      },
    })),
  );

  return chunks.length;
}
