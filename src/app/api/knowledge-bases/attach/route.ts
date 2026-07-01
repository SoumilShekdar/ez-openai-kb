import { z } from "zod";
import type { NextRequest } from "next/server";
import { attachKnowledgeBase } from "@/lib/knowledge-base";
import { requireAuthenticatedUserId } from "@/lib/kb-access";
import { getOpenAIForRequest } from "@/lib/openai-server";
import { getSessionState } from "@/lib/session";
import { errorResponse, jsonWithSession } from "@/lib/api";

const schema = z.object({
  vectorStoreId: z.string().trim().min(4),
  name: z.string().trim().max(100).optional().nullable(),
  description: z.string().trim().max(300).optional().nullable(),
});

export async function POST(request: NextRequest) {
  const sessionState = getSessionState(request);

  try {
    const ownerId = await requireAuthenticatedUserId();
    const payload = schema.parse(await request.json());
    const { client } = getOpenAIForRequest(request);
    const knowledgeBase = await attachKnowledgeBase(
      payload.vectorStoreId,
      client,
      ownerId,
      payload.name,
      payload.description,
    );

    return jsonWithSession(sessionState, { knowledgeBase });
  } catch (error) {
    return errorResponse(sessionState, error);
  }
}
