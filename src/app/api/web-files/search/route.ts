import { KeyMode, UsageEventType } from "@prisma/client";
import { z } from "zod";
import type { NextRequest } from "next/server";
import { errorResponse, jsonWithSession } from "@/lib/api";
import { recordUsageEvent } from "@/lib/knowledge-base";
import { getOpenAIForRequest } from "@/lib/openai-server";
import { enforceFallbackRateLimit } from "@/lib/rate-limit";
import { getSessionState } from "@/lib/session";
import { getDomainPresetOptions, searchWebForFiles } from "@/lib/web-search";

const schema = z.object({
  query: z.string().trim().min(2).max(300),
  preset: z.string().trim().optional().default("all"),
});

export async function POST(request: NextRequest) {
  const sessionState = getSessionState(request);

  try {
    const payload = schema.parse(await request.json());
    const { client, keyMode } = getOpenAIForRequest(request);
    await enforceFallbackRateLimit({
      request,
      sessionId: sessionState.sessionId,
      eventType: UsageEventType.WEB_SEARCH,
      keyMode,
    });
    const candidates = await searchWebForFiles(payload.query, payload.preset, client);

    await recordUsageEvent({
      sessionId: sessionState.sessionId,
      eventType: UsageEventType.WEB_SEARCH,
      keyMode: keyMode === "user" ? KeyMode.USER : KeyMode.FALLBACK,
    });

    return jsonWithSession(sessionState, {
      candidates,
      presets: getDomainPresetOptions(),
    });
  } catch (error) {
    return errorResponse(sessionState, error);
  }
}
