import { KeyMode, UsageEventType } from "@prisma/client";
import { z } from "zod";
import type { NextRequest } from "next/server";
import { errorResponse, jsonWithSession } from "@/lib/api";
import { recordUsageEvent, requireKnowledgeBase } from "@/lib/knowledge-base";
import { getOpenAIForRequest } from "@/lib/openai-server";
import { prisma } from "@/lib/prisma";
import { enforceFallbackRateLimit } from "@/lib/rate-limit";
import { getSessionState } from "@/lib/session";

const schema = z.object({
  question: z.string().trim().min(2).max(4000),
});

function extractMessageText(response: any) {
  if (response.output_text) {
    return response.output_text as string;
  }

  const message = response.output?.find((item: any) => item.type === "message");
  const outputText = message?.content?.find((part: any) => part.type === "output_text");
  return outputText?.text ?? "";
}

function extractCitations(response: any) {
  const citations: Array<{ fileId: string; filename: string; index: number }> = [];
  const message = response.output?.find((item: any) => item.type === "message");

  for (const part of message?.content ?? []) {
    if (part.type !== "output_text") {
      continue;
    }

    for (const annotation of part.annotations ?? []) {
      if (annotation.type !== "file_citation") {
        continue;
      }

      citations.push({
        fileId: annotation.file_id ?? "unknown",
        filename: annotation.filename ?? annotation.file_id ?? "Unknown file",
        index: annotation.index ?? 0,
      });
    }
  }

  const unique = new Map<string, { fileId: string; filename: string; index: number }>();
  for (const citation of citations) {
    unique.set(`${citation.fileId}:${citation.filename}`, citation);
  }

  return [...unique.values()];
}

function extractAnnotations(response: any) {
  const annotations: Array<{ text: string; fileId: string; filename: string; index: number }> = [];
  const message = response.output?.find((item: any) => item.type === "message");

  for (const part of message?.content ?? []) {
    if (part.type !== "output_text") {
      continue;
    }

    for (const annotation of part.annotations ?? []) {
      if (annotation.type !== "file_citation") {
        continue;
      }

      annotations.push({
        text: annotation.text ?? `【${annotation.index ?? 0}†source】`,
        fileId: annotation.file_id ?? "unknown",
        filename: annotation.filename ?? annotation.file_id ?? "Unknown file",
        index: annotation.index ?? 0,
      });
    }
  }

  return annotations;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const sessionState = getSessionState(request);

  try {
    const { id } = await context.params;
    const knowledgeBase = await requireKnowledgeBase(id);
    const { client, keyMode } = getOpenAIForRequest(request);
    const payload = schema.parse(await request.json());

    if (keyMode === "fallback") {
      await enforceFallbackRateLimit({
        prisma,
        sessionId: sessionState.sessionId,
        eventType: UsageEventType.CHAT,
      });
    }

    const response = await client.responses.create({
      model: "gpt-5.5",
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "You are a medical knowledge-base assistant. Answer ONLY using the retrieved file content. Do not use outside knowledge or general clinical knowledge. If the answer is not in the files, say: 'I cannot find that in the files.' For every sentence/statement you make, you must either ground it using a file citation (e.g. 【1†source】) or, if you must include outside knowledge or conversational filler that is not directly found in the files, you MUST append '[not in files]' at the end of that sentence.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: payload.question,
            },
          ],
        },
      ],
      tools: [
        {
          type: "file_search",
          vector_store_ids: [knowledgeBase.vectorStoreId],
          max_num_results: 8,
          ranking_options: {
            ranker: "auto",
            score_threshold: 0.15,
          },
        },
      ],
      include: ["file_search_call.results"],
    });

    await recordUsageEvent({
      sessionId: sessionState.sessionId,
      eventType: UsageEventType.CHAT,
      keyMode: keyMode === "user" ? KeyMode.USER : KeyMode.FALLBACK,
      knowledgeBaseId: knowledgeBase.id,
    });

    const answer = extractMessageText(response);
    const citations = extractCitations(response);
    const annotations = extractAnnotations(response);
    const warning =
      !answer.trim() || citations.length === 0
        ? "No files found or no relevant grounded results were retrieved for this question."
        : null;

    return jsonWithSession(sessionState, {
      answer,
      citations,
      annotations,
      warning,
    });
  } catch (error) {
    return errorResponse(sessionState, error);
  }
}
