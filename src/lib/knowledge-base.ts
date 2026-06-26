import { ImportSource, KeyMode, SourceMode, UsageEventType } from "@prisma/client";
import OpenAI from "openai";
import { ApiError } from "@/lib/api";
import { validateSupportedFile } from "@/lib/file-support";
import { prisma } from "@/lib/prisma";

export async function createKnowledgeBase(name: string, description: string | null, client: OpenAI) {
  const vectorStore = await client.vectorStores.create({
    name,
    metadata: description ? { description } : undefined,
  });

  return prisma.knowledgeBase.create({
    data: {
      name,
      description,
      vectorStoreId: vectorStore.id,
      sourceMode: SourceMode.CREATED,
    },
  });
}

export async function attachKnowledgeBase(
  vectorStoreId: string,
  client: OpenAI,
  name?: string | null,
  description?: string | null,
) {
  const vectorStore = await client.vectorStores.retrieve(vectorStoreId);

  const kb = await prisma.knowledgeBase.upsert({
    where: { vectorStoreId },
    update: {
      name: name?.trim() || vectorStore.name || "Attached knowledge base",
      description: description?.trim() || null,
      sourceMode: SourceMode.ATTACHED,
    },
    create: {
      name: name?.trim() || vectorStore.name || "Attached knowledge base",
      description: description?.trim() || null,
      vectorStoreId,
      sourceMode: SourceMode.ATTACHED,
    },
  });

  const remoteFiles = await client.vectorStores.files.list(vectorStoreId, {
    limit: 100,
  });

  for (const file of remoteFiles.data) {
    await prisma.knowledgeFile.upsert({
      where: {
        openaiFileId: file.id,
      },
      update: {
        knowledgeBaseId: kb.id,
        vectorStoreFileId: file.id,
        status: file.status === "completed" ? "COMPLETED" : file.status === "failed" ? "FAILED" : "IN_PROGRESS",
        attributesJson: file.attributes ? JSON.stringify(file.attributes) : null,
      },
      create: {
        knowledgeBaseId: kb.id,
        openaiFileId: file.id,
        vectorStoreFileId: file.id,
        originalName: file.id,
        importSource: ImportSource.EXTERNAL,
        status: file.status === "completed" ? "COMPLETED" : file.status === "failed" ? "FAILED" : "IN_PROGRESS",
        bytes: file.usage_bytes,
        attributesJson: file.attributes ? JSON.stringify(file.attributes) : null,
      },
    });
  }

  return kb;
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

export function buildVectorFileAttributes({
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

export async function saveKnowledgeFile({
  knowledgeBaseId,
  openaiFileId,
  vectorStoreFileId,
  originalName,
  importSource,
  sourceUrl,
  status,
  bytes,
  mimeType,
  attributes,
}: {
  knowledgeBaseId: string;
  openaiFileId: string;
  vectorStoreFileId?: string | null;
  originalName: string;
  importSource: ImportSource;
  sourceUrl?: string | null;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  bytes?: number | null;
  mimeType?: string | null;
  attributes?: Record<string, string | number | boolean> | null;
}) {
  validateSupportedFile(originalName, mimeType);

  return prisma.knowledgeFile.upsert({
    where: {
      openaiFileId,
    },
    update: {
      knowledgeBaseId,
      vectorStoreFileId: vectorStoreFileId ?? undefined,
      originalName,
      importSource,
      sourceUrl: sourceUrl ?? null,
      status,
      bytes: bytes ?? null,
      mimeType: mimeType ?? null,
      attributesJson: attributes ? JSON.stringify(attributes) : null,
    },
    create: {
      knowledgeBaseId,
      openaiFileId,
      vectorStoreFileId: vectorStoreFileId ?? null,
      originalName,
      importSource,
      sourceUrl: sourceUrl ?? null,
      status,
      bytes: bytes ?? null,
      mimeType: mimeType ?? null,
      attributesJson: attributes ? JSON.stringify(attributes) : null,
    },
  });
}
