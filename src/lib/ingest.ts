import { ImportSource } from "@prisma/client";
import type { QdrantClient } from "@qdrant/js-client-rest";
import type OpenAI from "openai";
import { ApiError } from "@/lib/api";
import { chunkText, parseDocument } from "@/lib/chunking";
import {
  buildFileAttributes,
  indexParsedDocument,
  saveKnowledgeFile,
  updateKnowledgeFileStatus,
} from "@/lib/knowledge-base";

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
