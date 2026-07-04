import type OpenAI from "openai";
import { DEFAULT_EMBEDDING_DIMENSIONS, DEFAULT_EMBEDDING_MODEL } from "@/lib/env";

const EMBEDDING_BATCH_SIZE = 64;

export async function embedTexts(
  client: OpenAI,
  texts: string[],
  model = DEFAULT_EMBEDDING_MODEL,
) {
  if (!texts.length) {
    return [];
  }

  const vectors: number[][] = [];

  for (let index = 0; index < texts.length; index += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(index, index + EMBEDDING_BATCH_SIZE);
    const response = await client.embeddings.create({
      model,
      input: batch,
      dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
    });

    for (const item of response.data) {
      vectors.push(item.embedding);
    }
  }

  return vectors;
}

export async function embedQuery(
  client: OpenAI,
  query: string,
  model = DEFAULT_EMBEDDING_MODEL,
) {
  const [vector] = await embedTexts(client, [query], model);
  return vector ?? [];
}
