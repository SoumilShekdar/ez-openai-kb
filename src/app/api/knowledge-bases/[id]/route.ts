import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthContext, requireReadableKnowledgeBase } from "@/lib/kb-access";
import { getSessionState } from "@/lib/session";
import { errorResponse, jsonWithSession } from "@/lib/api";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const sessionState = getSessionState(request);

  try {
    const { id } = await context.params;
    const authContext = await getAuthContext();
    await requireReadableKnowledgeBase(id, authContext);

    const knowledgeBase = await prisma.knowledgeBase.findUnique({
      where: { id },
      include: {
        files: {
          orderBy: {
            createdAt: "desc",
          },
        },
      },
    });

    return jsonWithSession(sessionState, { knowledgeBase });
  } catch (error) {
    return errorResponse(sessionState, error);
  }
}
