import type OpenAI from "openai";

export const DEFAULT_RAG_MODEL = "gpt-5.5";

export const DEFAULT_SYSTEM_PROMPT =
  "You are a medical knowledge-base assistant. Answer ONLY using the retrieved file content. Do not use outside knowledge or general clinical knowledge. If the answer is not in the files, say: 'I cannot find that in the files.' For every sentence/statement you make, you must either ground it using a file citation (e.g. 【1†source】) or, if you must include outside knowledge or conversational filler that is not directly found in the files, you MUST append '[not in files]' at the end of that sentence.";

export type RagCitation = {
  fileId: string;
  filename: string;
  index: number;
};

export type RagAnnotation = {
  text: string;
  fileId: string;
  filename: string;
  index: number;
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

type ResponsesOutput = {
  id?: string;
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
      annotations?: Array<{
        type?: string;
        file_id?: string;
        filename?: string;
        index?: number;
        text?: string;
      }>;
    }>;
  }>;
};

function extractMessageText(response: ResponsesOutput) {
  if (response.output_text) {
    return response.output_text;
  }

  const message = response.output?.find((item) => item.type === "message");
  const outputText = message?.content?.find((part) => part.type === "output_text");
  return outputText?.text ?? "";
}

function extractCitations(response: ResponsesOutput): RagCitation[] {
  const citations: RagCitation[] = [];
  const message = response.output?.find((item) => item.type === "message");

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

  const unique = new Map<string, RagCitation>();
  for (const citation of citations) {
    unique.set(`${citation.fileId}:${citation.filename}`, citation);
  }

  return [...unique.values()];
}

function extractAnnotations(response: ResponsesOutput): RagAnnotation[] {
  const annotations: RagAnnotation[] = [];
  const message = response.output?.find((item) => item.type === "message");

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

export function toResponsesInput(messages: RagMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: [
      {
        type: "input_text" as const,
        text: message.content,
      },
    ],
  }));
}

export async function runRagChat({
  client,
  vectorStoreId,
  messages,
  model = DEFAULT_RAG_MODEL,
  systemPrompt = DEFAULT_SYSTEM_PROMPT,
}: {
  client: OpenAI;
  vectorStoreId: string;
  messages: RagMessage[];
  model?: string;
  systemPrompt?: string;
}): Promise<RagResult> {
  const hasSystemMessage = messages.some((message) => message.role === "system");
  const inputMessages = hasSystemMessage
    ? messages
    : [{ role: "system" as const, content: systemPrompt }, ...messages];

  const response = await client.responses.create({
    model,
    input: toResponsesInput(inputMessages),
    tools: [
      {
        type: "file_search",
        vector_store_ids: [vectorStoreId],
        max_num_results: 8,
        ranking_options: {
          ranker: "auto",
          score_threshold: 0.15,
        },
      },
    ],
    include: ["file_search_call.results"],
  });

  const answer = extractMessageText(response);
  const citations = extractCitations(response);
  const annotations = extractAnnotations(response);
  const warning =
    !answer.trim() || citations.length === 0
      ? "No files found or no relevant grounded results were retrieved for this question."
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
