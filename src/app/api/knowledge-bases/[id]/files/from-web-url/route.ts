import { ImportSource, KeyMode, UsageEventType } from "@prisma/client";
import { z } from "zod";
import type { NextRequest } from "next/server";
import { errorResponse, jsonWithSession } from "@/lib/api";
import { findExistingKnowledgeFileBySourceUrl, recordUsageEvent } from "@/lib/knowledge-base";
import { getAuthContext, requireWritableKnowledgeBase } from "@/lib/kb-access";
import { getRagClients } from "@/lib/credentials";
import { enqueueIngestionJob } from "@/lib/ingest";
import { scheduleIngestion } from "@/lib/ingestion-scheduler";
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
    const { openai, qdrant, credentials } = await getRagClients(request, {
      knowledgeBase,
    });
    await enforceFallbackRateLimit({
      request,
      sessionId: sessionState.sessionId,
      eventType: UsageEventType.FILE_ADD,
      keyMode: credentials.keyMode,
    });

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
    const buffer = Buffer.from(await file.arrayBuffer());

    const { knowledgeFile, jobId } = await enqueueIngestionJob({
      knowledgeBaseId: knowledgeBase.id,
      filename: file.name,
      mimeType: file.type,
      buffer,
      importSource: ImportSource.WEB,
      sourceUrl: payload.url,
    });
    scheduleIngestion({
      jobId,
      openaiClient: openai,
      qdrantClient: qdrant,
      collectionName: knowledgeBase.qdrantCollectionName,
      embeddingModel: knowledgeBase.embeddingModel,
    });

    await recordUsageEvent({
      sessionId: sessionState.sessionId,
      eventType: UsageEventType.FILE_ADD,
      keyMode: credentials.keyMode === "user" ? KeyMode.USER : KeyMode.FALLBACK,
      knowledgeBaseId: knowledgeBase.id,
    });

    return jsonWithSession(sessionState, {
      knowledgeFile,
      duplicate: false,
      queued: true,
    });
  } catch (error) {
    return errorResponse(sessionState, error);
  }
}
