import OpenAI from "openai";
import { z } from "zod";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireKnowledgeBase } from "@/lib/knowledge-base";
import {
  getApiKeyFromCompatRequest,
  openAICompatErrorResponse,
  OpenAICompatError,
  resolveKnowledgeBaseId,
} from "@/lib/openai-compat";
import { DEFAULT_RAG_MODEL, runRagChat, toChatCompletionResponse } from "@/lib/rag";

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
    const apiKey = getApiKeyFromCompatRequest(request);
    const client = new OpenAI({ apiKey });

    const result = await runRagChat({
      client,
      vectorStoreId: knowledgeBase.vectorStoreId,
      messages: payload.messages,
      model: payload.model.startsWith("kb_") ? DEFAULT_RAG_MODEL : payload.model,
    });

    return NextResponse.json(
      toChatCompletionResponse({
        model: payload.model,
        result,
      }),
    );
  } catch (error) {
    return openAICompatErrorResponse(error);
  }
}
