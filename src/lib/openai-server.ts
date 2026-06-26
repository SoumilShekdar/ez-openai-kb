import OpenAI from "openai";
import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/api";

export type RequestKeyMode = "user" | "fallback";

export function getApiKeyFromRequest(request: NextRequest) {
  const userKey = request.headers.get("x-openai-api-key")?.trim();

  if (userKey) {
    return { apiKey: userKey, keyMode: "user" as const };
  }

  const fallbackKey = process.env.OPENAI_API_KEY?.trim();
  if (fallbackKey) {
    return { apiKey: fallbackKey, keyMode: "fallback" as const };
  }

  throw new ApiError(
    400,
    "No OpenAI API key is available. Add your own key in the app or configure OPENAI_API_KEY.",
  );
}

export function getOpenAIForRequest(request: NextRequest) {
  const { apiKey, keyMode } = getApiKeyFromRequest(request);
  return {
    keyMode,
    client: new OpenAI({ apiKey }),
  };
}
