import { after } from "next/server";
import type OpenAI from "openai";
import type { QdrantClient } from "@qdrant/js-client-rest";
import { processIngestionJob } from "@/lib/ingest";

export function scheduleIngestion({
  jobId,
  openaiClient,
  qdrantClient,
  collectionName,
  embeddingModel,
}: {
  jobId: string;
  openaiClient: OpenAI;
  qdrantClient: QdrantClient;
  collectionName: string;
  embeddingModel: string;
}) {
  after(async () => {
    try {
      await processIngestionJob({ jobId, openaiClient, qdrantClient, collectionName, embeddingModel });
    } catch (error) {
      console.error(`Ingestion job ${jobId} failed`, error);
    }
  });
}
