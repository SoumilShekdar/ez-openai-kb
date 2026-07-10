import type { NextRequest } from "next/server";
import { errorResponse, jsonWithSession } from "@/lib/api";
import { getAuthContext, requireWritableKnowledgeBase } from "@/lib/kb-access";
import { getRagClients } from "@/lib/credentials";
import { scheduleIngestion } from "@/lib/ingestion-scheduler";
import { prisma } from "@/lib/prisma";
import { getSessionState } from "@/lib/session";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const sessionState = getSessionState(request);
  try {
    const { id } = await context.params;
    const authContext = await getAuthContext();
    const knowledgeBase = await requireWritableKnowledgeBase(id, authContext);
    const { openai, qdrant } = await getRagClients(request, { knowledgeBase });
    const jobs = await prisma.ingestionJob.findMany({
      where: {
        knowledgeBaseId: knowledgeBase.id,
        OR: [
          { status: "PENDING" },
          { status: "IN_PROGRESS", updatedAt: { lt: new Date(Date.now() - 10 * 60 * 1000) } },
        ],
      },
      select: { id: true },
      take: 5,
      orderBy: { createdAt: "asc" },
    });
    for (const job of jobs) {
      scheduleIngestion({
        jobId: job.id,
        openaiClient: openai,
        qdrantClient: qdrant,
        collectionName: knowledgeBase.qdrantCollectionName,
        embeddingModel: knowledgeBase.embeddingModel,
      });
    }
    return jsonWithSession(sessionState, { queuedJobs: jobs.length });
  } catch (error) {
    return errorResponse(sessionState, error);
  }
}
