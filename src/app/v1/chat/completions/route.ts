import { KeyMode, UsageEventType } from "@prisma/client";
import OpenAI from "openai";
import { z } from "zod";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getAuthContext, requireReadKb } from "@/lib/kb-access";
import { recordUsageEvent, requireKnowledgeBase } from "@/lib/knowledge-base";
import { resolveCompatRagCredentials } from "@/lib/credentials";
import { createQdrantClient } from "@/lib/qdrant";
import {
  openAICompatErrorResponse,
  OpenAICompatError,
  resolveKnowledgeBaseId,
} from "@/lib/openai-compat";
import { DEFAULT_RAG_MODEL, runRagChat, toChatCompletionResponse } from "@/lib/rag";
import { applySessionCookie, getSessionState } from "@/lib/session";

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().trim().min(1).max(8000),
});

const schema = z.object({
  model: z.string().trim().min(1).optional().default(DEFAULT_RAG_MODEL),
  messages: z.array(messageSchema).min(1).max(50),
  temperature: z.number().min(0).max(2).optional(),
  stream: z.boolean().optional().default(false),
});

export async function POST(request: NextRequest) {
  const sessionState = getSessionState(request);

  try {
    const payload = schema.parse(await request.json());

    if (payload.stream) {
      throw new OpenAICompatError(
        501,
        "Streaming is not supported yet. Retry with stream=false.",
        "not_supported_error",
        "streaming_not_supported",
      );
    }

    const knowledgeBaseId = resolveKnowledgeBaseId(request, payload.model);
    const knowledgeBase = await requireKnowledgeBase(knowledgeBaseId);
    const authContext = await getAuthContext();

    if (knowledgeBase.visibility === "PRIVATE") {
      requireReadKb(knowledgeBase, authContext);
    }

    const credentials = resolveCompatRagCredentials(request, knowledgeBase);

    const openaiClient = new OpenAI({ apiKey: credentials.openaiApiKey });
    const qdrantClient = createQdrantClient(
      credentials.qdrantUrl,
      credentials.qdrantApiKey,
    );

    const result = await runRagChat({
      openaiClient,
      qdrantClient,
      collectionName: knowledgeBase.qdrantCollectionName,
      embeddingModel: knowledgeBase.embeddingModel,
      messages: payload.messages,
      model: payload.model.startsWith("kb_") ? DEFAULT_RAG_MODEL : payload.model,
    });

    await recordUsageEvent({
      sessionId: sessionState.sessionId,
      eventType: UsageEventType.CHAT,
      keyMode: credentials.keyMode === "user" ? KeyMode.USER : KeyMode.FALLBACK,
      knowledgeBaseId: knowledgeBase.id,
    });

    const response = NextResponse.json(
      toChatCompletionResponse({
        model: payload.model,
        result,
      }),
    );

    return applySessionCookie(response, sessionState);
  } catch (error) {
    return openAICompatErrorResponse(error, sessionState);
  }
}
