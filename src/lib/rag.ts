import type { QdrantClient } from "@qdrant/js-client-rest";
import type OpenAI from "openai";
import {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_QDRANT_SCORE_THRESHOLD,
  DEFAULT_RETRIEVAL_LIMIT,
} from "@/lib/env";
import { embedQuery } from "@/lib/embeddings";
import { searchCollection, type RetrievedChunk } from "@/lib/qdrant";

export const DEFAULT_RAG_MODEL = "gpt-4.1-mini";

export const DEFAULT_SYSTEM_PROMPT = [
  "You are a strict retrieval-grounded knowledge-base assistant.",
  "",
  "RULES:",
  "1. Answer using ONLY the information in the numbered context blocks provided below. Treat the context as your only source of truth.",
  "2. Do NOT use outside knowledge, prior training, general clinical knowledge, or assumptions. If it is not in the context, you do not know it.",
  "3. Every factual sentence MUST end with one or more citation markers in the exact format 【N†source】, where N is the number of the context block the fact came from. Cite every block you used.",
  "4. If the context does not contain the answer, respond with exactly: \"I cannot find that in the knowledge base.\" Do not add anything else.",
  "5. If the context only partially answers the question, answer only the part that is supported, then add a final sentence beginning with \"Not in the knowledge base:\" that briefly names what was asked but not found. Mark that sentence with [not in files].",
  "6. Do not include disclaimers, general advice, or conversational filler that is not grounded in the context.",
  "7. Never invent citation numbers. Only cite context blocks that actually exist.",
].join("\n");

export type RagCitation = {
  fileId: string;
  filename: string;
  index: number;
  sourceUrl?: string | null;
};

export type RagAnnotation = {
  text: string;
  fileId: string;
  filename: string;
  index: number;
  sourceUrl?: string | null;
};

export type RagMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type RagResult = {
  answer: string;
  citations: RagCitation[];
  annotations: RagAnnotation[];
  warning: string | null;
  responseId: string;
};

export type SearchResult = {
  fileId: string;
  filename: string;
  score: number;
  snippet: string;
  attributes: Record<string, string | number | boolean>;
};

function buildContextBlock(chunk: RetrievedChunk, index: number) {
  return `[${index + 1}] ${chunk.payload.filename}\n${chunk.payload.text}`;
}

function buildContextPrompt(chunks: RetrievedChunk[]) {
  return chunks.map((chunk, index) => buildContextBlock(chunk, index)).join("\n\n");
}

function chunksToCitations(chunks: RetrievedChunk[], indexes: number[]): RagCitation[] {
  const unique = new Map<string, RagCitation>();

  indexes.forEach((index) => {
    const chunk = chunks[index];
    unique.set(`${chunk.payload.fileId}:${chunk.payload.filename}`, {
      fileId: chunk.payload.fileId,
      filename: chunk.payload.filename,
      index,
      sourceUrl: chunk.payload.sourceUrl,
    });
  });

  return [...unique.values()];
}

function extractUsedCitationIndexes(answer: string, maxIndex: number) {
  const matches = answer.matchAll(/【(\d+)†source】/g);
  const indexes = new Set<number>();

  for (const match of matches) {
    const value = Number(match[1]);
    if (Number.isInteger(value) && value >= 1 && value <= maxIndex) {
      indexes.add(value - 1);
    }
  }

  return indexes;
}

function buildAnnotations(answer: string, chunks: RetrievedChunk[], usedIndexes: number[]): RagAnnotation[] {
  return usedIndexes.map((index) => {
    const chunk = chunks[index];
    return {
      text: `【${index + 1}†source】`,
      fileId: chunk.payload.fileId,
      filename: chunk.payload.filename,
      index,
      sourceUrl: chunk.payload.sourceUrl,
    };
  });
}

export async function retrieveRelevantChunks({
  openaiClient,
  qdrantClient,
  collectionName,
  query,
  embeddingModel = DEFAULT_EMBEDDING_MODEL,
  limit = DEFAULT_RETRIEVAL_LIMIT,
  scoreThreshold = DEFAULT_QDRANT_SCORE_THRESHOLD,
}: {
  openaiClient: OpenAI;
  qdrantClient: QdrantClient;
  collectionName: string;
  query: string;
  embeddingModel?: string;
  limit?: number;
  scoreThreshold?: number;
}) {
  const vector = await embedQuery(openaiClient, query, embeddingModel);
  return searchCollection(qdrantClient, collectionName, vector, {
    limit,
    scoreThreshold,
  });
}

export async function searchKnowledgeBase({
  openaiClient,
  qdrantClient,
  collectionName,
  query,
  embeddingModel = DEFAULT_EMBEDDING_MODEL,
}: {
  openaiClient: OpenAI;
  qdrantClient: QdrantClient;
  collectionName: string;
  query: string;
  embeddingModel?: string;
}): Promise<SearchResult[]> {
  const chunks = await retrieveRelevantChunks({
    openaiClient,
    qdrantClient,
    collectionName,
    query,
    embeddingModel,
  });

  return chunks.map((chunk) => ({
    fileId: chunk.payload.fileId,
    filename: chunk.payload.filename,
    score: chunk.score,
    snippet: chunk.payload.text,
    attributes: {
      source: chunk.payload.source,
      ...(chunk.payload.sourceUrl ? { source_url: chunk.payload.sourceUrl } : {}),
    },
  }));
}

export async function runRagChat({
  openaiClient,
  qdrantClient,
  collectionName,
  embeddingModel = DEFAULT_EMBEDDING_MODEL,
  messages,
  model = DEFAULT_RAG_MODEL,
  systemPrompt = DEFAULT_SYSTEM_PROMPT,
}: {
  openaiClient: OpenAI;
  qdrantClient: QdrantClient;
  collectionName: string;
  embeddingModel?: string;
  messages: RagMessage[];
  model?: string;
  systemPrompt?: string;
}): Promise<RagResult> {
  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");
  const query = lastUserMessage?.content?.trim() ?? "";

  const chunks = query
    ? await retrieveRelevantChunks({
        openaiClient,
        qdrantClient,
        collectionName,
        query,
        embeddingModel,
      })
    : [];

  if (!chunks.length) {
    return {
      answer: "I cannot find that in the files.",
      citations: [],
      annotations: [],
      warning:
        "No files found or no relevant grounded results were retrieved for this question.",
      responseId: `resp_${Date.now()}`,
    };
  }

  const context = buildContextPrompt(chunks);
  const conversationMessages = messages.filter((message) => message.role !== "system");

  const response = await openaiClient.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `${systemPrompt}\n\nNumbered context blocks:\n${context}`,
      },
      ...conversationMessages,
    ],
  });

  const answer = response.choices[0]?.message?.content?.trim() ?? "";
  const usedIndexes = [...extractUsedCitationIndexes(answer, chunks.length)];
  const citations = chunksToCitations(chunks, usedIndexes);
  const annotations = buildAnnotations(answer, chunks, usedIndexes);
  const warning =
    !answer.trim() || annotations.length === 0
      ? "No grounded answer could be verified because the response did not include valid source citations."
      : null;

  return {
    answer,
    citations,
    annotations,
    warning,
    responseId: response.id ?? `resp_${Date.now()}`,
  };
}

export function toChatCompletionResponse({
  model,
  result,
}: {
  model: string;
  result: RagResult;
}) {
  return {
    id: `chatcmpl_${result.responseId.replace(/^resp_/, "")}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant" as const,
          content: result.answer,
          annotations: result.annotations.map((annotation) => ({
            type: "file_citation" as const,
            text: annotation.text,
            file_citation: {
              file_id: annotation.fileId,
              filename: annotation.filename,
              index: annotation.index,
            },
          })),
        },
        finish_reason: "stop" as const,
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
    citations: result.citations,
    warning: result.warning,
  };
}
