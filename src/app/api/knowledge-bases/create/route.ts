import { z } from "zod";
import type { NextRequest } from "next/server";
import { createKnowledgeBase } from "@/lib/knowledge-base";
import { requireAuthenticatedUserId } from "@/lib/kb-access";
import { getOpenAIForRequest } from "@/lib/openai-server";
import { getSessionState } from "@/lib/session";
import { errorResponse, jsonWithSession } from "@/lib/api";

const schema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(300).optional().nullable(),
});

export async function POST(request: NextRequest) {
  const sessionState = getSessionState(request);

  try {
    const ownerId = await requireAuthenticatedUserId();
    const payload = schema.parse(await request.json());
    const { client } = getOpenAIForRequest(request);
    const knowledgeBase = await createKnowledgeBase(
      payload.name,
      payload.description ?? null,
      client,
      ownerId,
    );

    return jsonWithSession(sessionState, { knowledgeBase });
  } catch (error) {
    return errorResponse(sessionState, error);
  }
}
