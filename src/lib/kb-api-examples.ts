import { DEFAULT_RAG_MODEL } from "@/lib/rag";

type ExampleParams = {
  baseUrl: string;
  kbId: string;
};

const SAMPLE_QUESTION = "What does the knowledge base say about treatment?";

export const CHAT_COMPLETIONS_RESPONSE_EXAMPLE = JSON.stringify(
  {
    id: "chatcmpl_abc123",
    object: "chat.completion",
    created: 1717171717,
    model: DEFAULT_RAG_MODEL,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content:
            "Based on the indexed sources, the recommended treatment approach is outlined in the clinical guidelines document.",
          annotations: [
            {
              type: "file_citation",
              text: "【1†source】",
              file_citation: {
                file_id: "file-abc123",
                filename: "clinical-guidelines.pdf",
                index: 0,
              },
            },
          ],
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
    citations: [
      {
        fileId: "file-abc123",
        filename: "clinical-guidelines.pdf",
        index: 0,
      },
    ],
    warning: null,
  },
  null,
  2,
);

export function buildChatCompletionsCurlExample({ baseUrl, kbId }: ExampleParams) {
  const url = `${baseUrl}/v1/chat/completions`;
  const body = JSON.stringify(
    {
      model: DEFAULT_RAG_MODEL,
      messages: [{ role: "user", content: SAMPLE_QUESTION }],
      stream: false,
    },
    null,
    2,
  );

  return `curl ${url} \\
  -H "Authorization: Bearer $OPENAI_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "x-knowledge-base-id: ${kbId}" \\
  -d '${body.replace(/'/g, "'\\''")}'`;
}

export function buildChatCompletionsFetchExample({ baseUrl, kbId }: ExampleParams) {
  const url = `${baseUrl}/v1/chat/completions`;

  return `const response = await fetch("${url}", {
  method: "POST",
  headers: {
    Authorization: "Bearer " + process.env.OPENAI_API_KEY,
    "Content-Type": "application/json",
    "x-knowledge-base-id": "${kbId}",
  },
  body: JSON.stringify({
    model: "${DEFAULT_RAG_MODEL}",
    messages: [
      { role: "user", content: "${SAMPLE_QUESTION}" },
    ],
    stream: false,
  }),
});

const data = await response.json();
console.log(data.choices[0].message.content);
console.log(data.citations);`;
}
