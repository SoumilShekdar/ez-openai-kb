import { z } from "zod";
import type { NextRequest } from "next/server";
import { errorResponse, jsonWithSession } from "@/lib/api";
import { getDomainPresetOptions, searchWebForFiles } from "@/lib/web-search";
import { getSessionState } from "@/lib/session";

const schema = z.object({
  query: z.string().trim().min(2).max(300),
  preset: z.string().trim().optional().default("all"),
});

export async function POST(request: NextRequest) {
  const sessionState = getSessionState(request);

  try {
    const payload = schema.parse(await request.json());
    const candidates = await searchWebForFiles(payload.query, payload.preset);

    return jsonWithSession(sessionState, {
      candidates,
      presets: getDomainPresetOptions(),
    });
  } catch (error) {
    return errorResponse(sessionState, error);
  }
}
