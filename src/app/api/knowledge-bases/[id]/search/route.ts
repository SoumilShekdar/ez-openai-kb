import { KeyMode, UsageEventType } from "@prisma/client";
import { z } from "zod";
import type { NextRequest } from "next/server";
import { errorResponse, jsonWithSession } from "@/lib/api";
import { getAuthContext, requireReadableKnowledgeBase } from "@/lib/kb-access";
import { recordUsageEvent } from "@/lib/knowledge-base";
import { getRagClients } from "@/lib/credentials";
import { searchKnowledgeBase } from "@/lib/rag";
import { getSessionState } from "@/lib/session";

const schema = z.object({
  query: z.string().trim().min(2).max(500),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const sessionState = getSessionState(request);

  try {
    const { id } = await context.params;
    const authContext = await getAuthContext();
    const knowledgeBase = await requireReadableKnowledgeBase(id, authContext);
    const { openai, qdrant, credentials } = getRagClients(request, {
      knowledgeBase,
    });
    const payload = schema.parse(await request.json());

    const results = await searchKnowledgeBase({
      openaiClient: openai,
      qdrantClient: qdrant,
      collectionName: knowledgeBase.qdrantCollectionName,
      query: payload.query,
      embeddingModel: knowledgeBase.embeddingModel,
    });

    await recordUsageEvent({
      sessionId: sessionState.sessionId,
      eventType: UsageEventType.SEARCH,
      keyMode: credentials.keyMode === "user" ? KeyMode.USER : KeyMode.FALLBACK,
      knowledgeBaseId: knowledgeBase.id,
    });

    return jsonWithSession(sessionState, {
      results,
      warning: results.length
        ? null
        : "No matching information was found in this knowledge base.",
    });
  } catch (error) {
    return errorResponse(sessionState, error);
  }
}
