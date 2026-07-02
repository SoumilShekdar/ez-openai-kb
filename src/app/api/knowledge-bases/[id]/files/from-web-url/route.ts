import { ImportSource, KeyMode, UsageEventType } from "@prisma/client";
import { z } from "zod";
import type { NextRequest } from "next/server";
import { errorResponse, jsonWithSession } from "@/lib/api";
import { buildVectorFileAttributes, findExistingKnowledgeFileBySourceUrl, recordUsageEvent, saveKnowledgeFile } from "@/lib/knowledge-base";
import { getAuthContext, requireWritableKnowledgeBase } from "@/lib/kb-access";
import { getOpenAIForRequest } from "@/lib/openai-server";
import { prisma } from "@/lib/prisma";
import { enforceFallbackRateLimit } from "@/lib/rate-limit";
import { downloadRemoteFile } from "@/lib/remote-file";
import { getSessionState } from "@/lib/session";

const schema = z.object({
  url: z.string().url(),
});

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

    const payload = schema.parse(await request.json());

    const existingFile = await findExistingKnowledgeFileBySourceUrl(
      knowledgeBase.id,
      payload.url,
    );
    if (existingFile) {
      return jsonWithSession(sessionState, {
        knowledgeFile: existingFile,
        duplicate: true,
      });
    }

    const file = await downloadRemoteFile(payload.url);

    const uploaded = await client.files.create({
      file,
      purpose: "assistants",
    });

    const attributes = buildVectorFileAttributes({
      source: ImportSource.WEB,
      sourceUrl: payload.url,
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
      importSource: ImportSource.WEB,
      sourceUrl: payload.url,
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

    return jsonWithSession(sessionState, {
      knowledgeFile,
      duplicate: false,
    });
  } catch (error) {
    return errorResponse(sessionState, error);
  }
}
