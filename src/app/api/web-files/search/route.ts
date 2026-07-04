import { KeyMode, UsageEventType } from "@prisma/client";
import { z } from "zod";
import type { NextRequest } from "next/server";
import { errorResponse, jsonWithSession } from "@/lib/api";
import { recordUsageEvent } from "@/lib/knowledge-base";
import { prisma } from "@/lib/prisma";
import { enforceWebSearchRateLimit } from "@/lib/rate-limit";
import { getSessionState } from "@/lib/session";
import { getDomainPresetOptions, searchWebForFiles } from "@/lib/web-search";

const schema = z.object({
  query: z.string().trim().min(2).max(300),
  preset: z.string().trim().optional().default("all"),
});

export async function POST(request: NextRequest) {
  const sessionState = getSessionState(request);

  try {
    await enforceWebSearchRateLimit({
      prisma,
      sessionId: sessionState.sessionId,
    });

    const payload = schema.parse(await request.json());
    const candidates = await searchWebForFiles(payload.query, payload.preset);

    await recordUsageEvent({
      sessionId: sessionState.sessionId,
      eventType: UsageEventType.WEB_SEARCH,
      keyMode: KeyMode.FALLBACK,
    });

    return jsonWithSession(sessionState, {
      candidates,
      presets: getDomainPresetOptions(),
    });
  } catch (error) {
    return errorResponse(sessionState, error);
  }
}
