import { KeyMode, UsageEventType } from "@prisma/client";
import { z } from "zod";
import type { NextRequest } from "next/server";
import { ApiError, errorResponse, jsonWithSession } from "@/lib/api";
import { recordUsageEvent, requireKnowledgeBase } from "@/lib/knowledge-base";
import { getOpenAIForRequest } from "@/lib/openai-server";
import { prisma } from "@/lib/prisma";
import { enforceFallbackRateLimit } from "@/lib/rate-limit";
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
    const knowledgeBase = await requireKnowledgeBase(id);
    const { client, keyMode } = getOpenAIForRequest(request);
    const payload = schema.parse(await request.json());

    if (keyMode === "fallback") {
      await enforceFallbackRateLimit({
        prisma,
        sessionId: sessionState.sessionId,
        eventType: UsageEventType.SEARCH,
      });
    }

    const response = await client.vectorStores.search(knowledgeBase.vectorStoreId, {
      query: payload.query,
      max_num_results: 8,
      rewrite_query: true,
    });

    await recordUsageEvent({
      sessionId: sessionState.sessionId,
      eventType: UsageEventType.SEARCH,
      keyMode: keyMode === "user" ? KeyMode.USER : KeyMode.FALLBACK,
      knowledgeBaseId: knowledgeBase.id,
    });

    const results = response.data.map((result) => ({
      fileId: result.file_id,
      filename: result.filename,
      score: result.score,
      snippet: result.content[0]?.text ?? "",
      attributes: result.attributes ?? {},
    }));

    if (!results.length) {
      throw new ApiError(
        404,
        "No files found or no relevant grounded results were retrieved for this question.",
      );
    }

    return jsonWithSession(sessionState, { results });
  } catch (error) {
    return errorResponse(sessionState, error);
  }
}
