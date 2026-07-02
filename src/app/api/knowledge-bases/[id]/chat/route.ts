import { KeyMode, UsageEventType } from "@prisma/client";
import { z } from "zod";
import type { NextRequest } from "next/server";
import { errorResponse, jsonWithSession } from "@/lib/api";
import { getAuthContext, requireReadableKnowledgeBase } from "@/lib/kb-access";
import { recordUsageEvent } from "@/lib/knowledge-base";
import { getOpenAIForRequest } from "@/lib/openai-server";
import { prisma } from "@/lib/prisma";
import { runRagChat } from "@/lib/rag";
import { enforceFallbackRateLimit } from "@/lib/rate-limit";
import { getSessionState } from "@/lib/session";

const schema = z.object({
  question: z.string().trim().min(2).max(4000),
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
    const { client, keyMode } = getOpenAIForRequest(request);
    const payload = schema.parse(await request.json());

    if (keyMode === "fallback") {
      await enforceFallbackRateLimit({
        prisma,
        sessionId: sessionState.sessionId,
        eventType: UsageEventType.CHAT,
      });
    }

    const result = await runRagChat({
      client,
      vectorStoreId: knowledgeBase.vectorStoreId,
      messages: [{ role: "user", content: payload.question }],
    });

    await recordUsageEvent({
      sessionId: sessionState.sessionId,
      eventType: UsageEventType.CHAT,
      keyMode: keyMode === "user" ? KeyMode.USER : KeyMode.FALLBACK,
      knowledgeBaseId: knowledgeBase.id,
    });

    return jsonWithSession(sessionState, {
      answer: result.answer,
      citations: result.citations,
      annotations: result.annotations,
      warning: result.warning,
    });
  } catch (error) {
    return errorResponse(sessionState, error);
  }
}
