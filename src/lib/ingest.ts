import { ImportSource } from "@prisma/client";
import type { QdrantClient } from "@qdrant/js-client-rest";
import type OpenAI from "openai";
import { ApiError } from "@/lib/api";
import { chunkText, parseDocument } from "@/lib/chunking";
import {
  buildFileAttributes,
  indexParsedDocument,
  removeKnowledgeFileVectors,
  saveKnowledgeFile,
  updateKnowledgeFileStatus,
} from "@/lib/knowledge-base";
import { prisma } from "@/lib/prisma";

type IngestionInput = {
  knowledgeBaseId: string;
  filename: string;
  mimeType?: string | null;
  buffer: Buffer;
  importSource: ImportSource;
  sourceUrl?: string | null;
};

export async function enqueueIngestionJob(input: IngestionInput) {
  const attributes = buildFileAttributes({
    source: input.importSource,
    sourceUrl: input.sourceUrl,
  });
  const knowledgeFile = await saveKnowledgeFile({
    knowledgeBaseId: input.knowledgeBaseId,
    originalName: input.filename,
    importSource: input.importSource,
    sourceUrl: input.sourceUrl,
    status: "PENDING",
    bytes: input.buffer.length,
    mimeType: input.mimeType,
    attributes,
  });

  const job = await prisma.ingestionJob.create({
    data: {
      knowledgeBaseId: input.knowledgeBaseId,
      knowledgeFileId: knowledgeFile.id,
      importSource: input.importSource,
      sourceUrl: input.sourceUrl ?? null,
      payload: input.buffer,
    },
  });

  return { knowledgeFile, jobId: job.id };
}

export async function processIngestionJob({
  jobId,
  openaiClient,
  qdrantClient,
  collectionName,
  embeddingModel,
}: {
  jobId: string;
  openaiClient: OpenAI;
  qdrantClient: QdrantClient;
  collectionName: string;
  embeddingModel: string;
}) {
  const staleBefore = new Date(Date.now() - 10 * 60 * 1000);
  const claimed = await prisma.ingestionJob.updateMany({
    where: {
      id: jobId,
      OR: [
        { status: "PENDING" },
        { status: "IN_PROGRESS", updatedAt: { lt: staleBefore } },
      ],
    },
    data: { status: "IN_PROGRESS", attempts: { increment: 1 }, lastError: null },
  });
  if (!claimed.count) return;

  const job = await prisma.ingestionJob.findUniqueOrThrow({
    where: { id: jobId },
    include: { knowledgeFile: true },
  });
  await updateKnowledgeFileStatus(job.knowledgeFileId, { status: "IN_PROGRESS" });

  try {
    const parsed = await parseDocument(job.knowledgeFile.originalName, job.knowledgeFile.mimeType, Buffer.from(job.payload));
    // A retry can follow a timeout after vectors were written but before the
    // database status was saved. Removing prior chunks keeps retries idempotent.
    await removeKnowledgeFileVectors({ qdrantClient, collectionName, fileId: job.knowledgeFileId });
    const chunkCount = await indexParsedDocument({
      openaiClient,
      qdrantClient,
      knowledgeBaseId: job.knowledgeBaseId,
      collectionName,
      fileId: job.knowledgeFileId,
      filename: job.knowledgeFile.originalName,
      importSource: job.importSource,
      sourceUrl: job.sourceUrl,
      text: parsed.text,
      embeddingModel,
    });
    await prisma.$transaction([
      prisma.knowledgeFile.update({ where: { id: job.knowledgeFileId }, data: { status: "COMPLETED", chunkCount } }),
      prisma.ingestionJob.update({ where: { id: jobId }, data: { status: "COMPLETED", payload: Buffer.alloc(0) } }),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "Ingestion failed.";
    await prisma.$transaction([
      prisma.knowledgeFile.update({ where: { id: job.knowledgeFileId }, data: { status: "FAILED" } }),
      prisma.ingestionJob.update({ where: { id: jobId }, data: { status: "FAILED", lastError: message } }),
    ]);
    throw error;
  }
}

export async function ingestKnowledgeFile({
  openaiClient,
  qdrantClient,
  knowledgeBaseId,
  collectionName,
  embeddingModel,
  filename,
  mimeType,
  buffer,
  importSource,
  sourceUrl,
}: {
  openaiClient: OpenAI;
  qdrantClient: QdrantClient;
  knowledgeBaseId: string;
  collectionName: string;
  embeddingModel: string;
  filename: string;
  mimeType?: string | null;
  buffer: Buffer;
  importSource: ImportSource;
  sourceUrl?: string | null;
}) {
  const attributes = buildFileAttributes({
    source: importSource,
    sourceUrl,
  });

  const knowledgeFile = await saveKnowledgeFile({
    knowledgeBaseId,
    originalName: filename,
    importSource,
    sourceUrl,
    status: "IN_PROGRESS",
    bytes: buffer.length,
    mimeType,
    attributes,
  });

  try {
    const parsed = await parseDocument(filename, mimeType, buffer);
    const chunks = chunkText(parsed.text);

    if (!chunks.length) {
      throw new ApiError(400, `No indexable text was found in "${filename}".`);
    }

    const chunkCount = await indexParsedDocument({
      openaiClient,
      qdrantClient,
      knowledgeBaseId,
      collectionName,
      fileId: knowledgeFile.id,
      filename,
      importSource,
      sourceUrl,
      text: parsed.text,
      embeddingModel,
    });

    return updateKnowledgeFileStatus(knowledgeFile.id, {
      status: "COMPLETED",
      chunkCount,
    });
  } catch (error) {
    await updateKnowledgeFileStatus(knowledgeFile.id, {
      status: "FAILED",
    });
    throw error;
  }
}

export async function ingestFileObject({
  openaiClient,
  qdrantClient,
  knowledgeBaseId,
  collectionName,
  embeddingModel,
  file,
  importSource,
  sourceUrl,
}: {
  openaiClient: OpenAI;
  qdrantClient: QdrantClient;
  knowledgeBaseId: string;
  collectionName: string;
  embeddingModel: string;
  file: File;
  importSource: ImportSource;
  sourceUrl?: string | null;
}) {
  const buffer = Buffer.from(await file.arrayBuffer());

  return ingestKnowledgeFile({
    openaiClient,
    qdrantClient,
    knowledgeBaseId,
    collectionName,
    embeddingModel,
    filename: file.name,
    mimeType: file.type,
    buffer,
    importSource,
    sourceUrl,
  });
}
