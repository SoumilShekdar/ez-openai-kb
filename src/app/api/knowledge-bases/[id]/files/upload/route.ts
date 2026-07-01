import { ImportSource, KeyMode, UsageEventType } from "@prisma/client";
import type { NextRequest } from "next/server";
import { buildVectorFileAttributes, findExistingKnowledgeFileBySourceUrl, recordUsageEvent, saveKnowledgeFile } from "@/lib/knowledge-base";
import { getAuthContext, requireWritableKnowledgeBase } from "@/lib/kb-access";
import { getOpenAIForRequest } from "@/lib/openai-server";
import { getSessionState } from "@/lib/session";
import { errorResponse, jsonWithSession, ApiError } from "@/lib/api";
import { validateSupportedFile } from "@/lib/file-support";
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
    const { client, keyMode } = getOpenAIForRequest(request);

    if (keyMode === "fallback") {
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

    const uploaded = await client.files.create({
      file,
      purpose: "assistants",
    });

    const attributes = buildVectorFileAttributes({
      source: ImportSource.LOCAL,
    });

    const vectorFile = await client.vectorStores.files.createAndPoll(
      knowledgeBase.vectorStoreId,
      {
        file_id: uploaded.id,
        attributes,
      },
    );

    const knowledgeFile = await saveKnowledgeFile({
      knowledgeBaseId: knowledgeBase.id,
      openaiFileId: uploaded.id,
      vectorStoreFileId: vectorFile.id,
      originalName: file.name,
      importSource: ImportSource.LOCAL,
      status:
        vectorFile.status === "completed"
          ? "COMPLETED"
          : vectorFile.status === "failed"
            ? "FAILED"
            : "IN_PROGRESS",
      bytes: file.size,
      mimeType: file.type,
      attributes,
    });

    await recordUsageEvent({
      sessionId: sessionState.sessionId,
      eventType: UsageEventType.FILE_ADD,
      keyMode: keyMode === "user" ? KeyMode.USER : KeyMode.FALLBACK,
      knowledgeBaseId: knowledgeBase.id,
    });

    return jsonWithSession(sessionState, { knowledgeFile });
  } catch (error) {
    return errorResponse(sessionState, error);
  }
}
