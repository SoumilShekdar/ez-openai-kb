import { KbVisibility } from "@prisma/client";
import { z } from "zod";
import type { NextRequest } from "next/server";
import { createKnowledgeBase } from "@/lib/knowledge-base";
import { getRagClients } from "@/lib/credentials";
import { requireAuthenticatedUserId } from "@/lib/kb-access";
import { getSessionState } from "@/lib/session";
import { errorResponse, jsonWithSession } from "@/lib/api";

const schema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(300).optional().nullable(),
  visibility: z.nativeEnum(KbVisibility).optional().default(KbVisibility.PRIVATE),
});

export async function POST(request: NextRequest) {
  const sessionState = getSessionState(request);

  try {
    const ownerId = await requireAuthenticatedUserId();
    const payload = schema.parse(await request.json());
    const { openai, qdrant, credentials } = await getRagClients(request, {
      knowledgeBase: { visibility: payload.visibility },
    });

    const knowledgeBase = await createKnowledgeBase(
      payload.name,
      payload.description ?? null,
      ownerId,
      qdrant,
      payload.visibility,
    );

    return jsonWithSession(sessionState, {
      knowledgeBase,
      credentialsMode: credentials.keyMode,
      openaiConfigured: Boolean(openai),
    });
  } catch (error) {
    return errorResponse(sessionState, error);
  }
}
