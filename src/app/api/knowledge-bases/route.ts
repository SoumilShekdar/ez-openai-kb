import { prisma } from "@/lib/prisma";
import { getSessionState } from "@/lib/session";
import { errorResponse, jsonWithSession } from "@/lib/api";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const sessionState = getSessionState(request);

  try {
    const knowledgeBases = await prisma.knowledgeBase.findMany({
      include: {
        files: {
          orderBy: {
            createdAt: "desc",
          },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    return jsonWithSession(sessionState, { knowledgeBases });
  } catch (error) {
    return errorResponse(sessionState, error);
  }
}
