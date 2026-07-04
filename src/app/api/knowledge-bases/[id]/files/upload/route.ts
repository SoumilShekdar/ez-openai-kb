import { ImportSource, KeyMode, UsageEventType } from "@prisma/client";
import type { NextRequest } from "next/server";
import { recordUsageEvent } from "@/lib/knowledge-base";
import { getAuthContext, requireWritableKnowledgeBase } from "@/lib/kb-access";
import { getRagClients } from "@/lib/credentials";
import { ingestFileObject } from "@/lib/ingest";
import { getSessionState } from "@/lib/session";
import { errorResponse, jsonWithSession, ApiError } from "@/lib/api";
import { validateSupportedFile, MAX_UPLOAD_BYTES } from "@/lib/file-support";
import { prisma } from "@/lib/prisma";
import { enforceFallbackRateLimit } from "@/lib/rate-limit";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const sessionState = getSessionState(request);

  try {
    const { id } = await context.params;
    const authContext = await getAuthContext();
    const knowledgeBase = await requireWritableKnowledgeBase(id, authContext);
    const { openai, qdrant, credentials } = getRagClients(request, {
      knowledgeBase,
    });

    if (credentials.keyMode === "fallback") {
      await enforceFallbackRateLimit({
        prisma,
        sessionId: sessionState.sessionId,
        eventType: UsageEventType.FILE_ADD,
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

    const knowledgeFile = await ingestFileObject({
      openaiClient: openai,
      qdrantClient: qdrant,
      knowledgeBaseId: knowledgeBase.id,
      collectionName: knowledgeBase.qdrantCollectionName,
      embeddingModel: knowledgeBase.embeddingModel,
      file,
      importSource: ImportSource.LOCAL,
    });

    await recordUsageEvent({
      sessionId: sessionState.sessionId,
      eventType: UsageEventType.FILE_ADD,
      keyMode: credentials.keyMode === "user" ? KeyMode.USER : KeyMode.FALLBACK,
      knowledgeBaseId: knowledgeBase.id,
    });

    return jsonWithSession(sessionState, { knowledgeFile });
  } catch (error) {
    return errorResponse(sessionState, error);
  }
}
