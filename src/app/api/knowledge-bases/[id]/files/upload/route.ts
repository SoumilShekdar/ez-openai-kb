import { ImportSource, KeyMode, UsageEventType } from "@prisma/client";
import type { NextRequest } from "next/server";
import { recordUsageEvent } from "@/lib/knowledge-base";
import { getAuthContext, requireWritableKnowledgeBase } from "@/lib/kb-access";
import { getRagClients } from "@/lib/credentials";
import { enqueueIngestionJob } from "@/lib/ingest";
import { scheduleIngestion } from "@/lib/ingestion-scheduler";
import { getSessionState } from "@/lib/session";
import { errorResponse, jsonWithSession, ApiError } from "@/lib/api";
import { validateSupportedFile, MAX_UPLOAD_BYTES } from "@/lib/file-support";
import { prisma } from "@/lib/prisma";
import { enforceFallbackRateLimit, getRateLimitKey } from "@/lib/rate-limit";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const sessionState = getSessionState(request);

  try {
    const { id } = await context.params;
    const authContext = await getAuthContext();
    const knowledgeBase = await requireWritableKnowledgeBase(id, authContext);
    const { openai, qdrant, credentials } = await getRagClients(request, {
      knowledgeBase,
    });

    if (credentials.keyMode === "fallback") {
      await enforceFallbackRateLimit({
        prisma,
        sessionId: sessionState.sessionId,
        rateLimitKey: getRateLimitKey(request, authContext.userId, sessionState.sessionId),
        eventType: UsageEventType.FILE_ADD,
        knowledgeBaseId: knowledgeBase.id,
      });
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      throw new ApiError(400, "Select a file to upload.");
    }

    validateSupportedFile(file.name, file.type);

    if (file.size > MAX_UPLOAD_BYTES) {
      throw new ApiError(
        400,
        `File size exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit.`,
      );
    }

    const { knowledgeFile, jobId } = await enqueueIngestionJob({
      knowledgeBaseId: knowledgeBase.id,
      filename: file.name,
      mimeType: file.type,
      buffer: Buffer.from(await file.arrayBuffer()),
      importSource: ImportSource.LOCAL,
    });
    scheduleIngestion({ jobId, openaiClient: openai, qdrantClient: qdrant, collectionName: knowledgeBase.qdrantCollectionName, embeddingModel: knowledgeBase.embeddingModel });

    await recordUsageEvent({
      sessionId: sessionState.sessionId,
      eventType: UsageEventType.FILE_ADD,
      keyMode: credentials.keyMode === "user" ? KeyMode.USER : KeyMode.FALLBACK,
      knowledgeBaseId: knowledgeBase.id,
    });

    return jsonWithSession(sessionState, { knowledgeFile, queued: true });
  } catch (error) {
    return errorResponse(sessionState, error);
  }
}
