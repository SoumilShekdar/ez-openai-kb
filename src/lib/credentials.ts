import type { KnowledgeBase } from "@prisma/client";
import type { NextRequest } from "next/server";
import OpenAI from "openai";
import { ApiError } from "@/lib/api";
import {
  getFallbackOpenAIKey,
  getFallbackQdrantApiKey,
  getFallbackQdrantUrl,
} from "@/lib/env";
import { createQdrantClient } from "@/lib/qdrant";

export type CredentialMode = "user" | "fallback";

export type RagCredentials = {
  openaiApiKey: string;
  qdrantUrl: string;
  qdrantApiKey: string | null;
  keyMode: CredentialMode;
};

function readHeader(request: NextRequest, name: string) {
  return request.headers.get(name)?.trim() || null;
}

export function getOpenAIKeyFromRequest(request: NextRequest) {
  const userKey = readHeader(request, "x-openai-api-key");
  if (userKey) {
    return { apiKey: userKey, keyMode: "user" as const };
  }

  const fallbackKey = getFallbackOpenAIKey();
  if (fallbackKey) {
    return { apiKey: fallbackKey, keyMode: "fallback" as const };
  }

  return null;
}

export function getQdrantCredentialsFromRequest(request: NextRequest) {
  const userUrl = readHeader(request, "x-qdrant-url");
  const userApiKey = readHeader(request, "x-qdrant-api-key");

  if (userUrl) {
    return {
      url: userUrl,
      apiKey: userApiKey,
      keyMode: "user" as const,
    };
  }

  const fallbackUrl = getFallbackQdrantUrl();
  const fallbackApiKey = getFallbackQdrantApiKey();

  if (fallbackUrl) {
    return {
      url: fallbackUrl,
      apiKey: fallbackApiKey,
      keyMode: "fallback" as const,
    };
  }

  return null;
}

export function resolveRagCredentials(
  request: NextRequest,
  options?: {
    requireUserCredentials?: boolean;
    knowledgeBase?: Pick<KnowledgeBase, "visibility">;
  },
): RagCredentials {
  const openai = getOpenAIKeyFromRequest(request);
  const qdrant = getQdrantCredentialsFromRequest(request);

  const isPrivate = options?.knowledgeBase?.visibility === "PRIVATE";
  const requireUser = options?.requireUserCredentials ?? isPrivate;

  if (requireUser) {
    const userOpenAI = readHeader(request, "x-openai-api-key");
    const userQdrantUrl = readHeader(request, "x-qdrant-url");
    const userQdrantKey = readHeader(request, "x-qdrant-api-key");

    if (!userOpenAI || !userQdrantUrl || !userQdrantKey) {
      throw new ApiError(
        400,
        "Private knowledge bases require your OpenAI API key, Qdrant URL, and Qdrant API key in the Runtime RAG Credentials settings.",
      );
    }

    return {
      openaiApiKey: userOpenAI,
      qdrantUrl: userQdrantUrl,
      qdrantApiKey: userQdrantKey,
      keyMode: "user",
    };
  }

  if (!openai) {
    throw new ApiError(
      400,
      "No OpenAI API key is available. Add your own key in the app or configure OPENAI_API_KEY.",
    );
  }

  if (!qdrant) {
    throw new ApiError(
      400,
      "No Qdrant credentials are available. Add your Qdrant URL and API key in the app or configure QDRANT_URL.",
    );
  }

  return {
    openaiApiKey: openai.apiKey,
    qdrantUrl: qdrant.url,
    qdrantApiKey: qdrant.apiKey,
    keyMode: openai.keyMode === "user" || qdrant.keyMode === "user" ? "user" : "fallback",
  };
}

export function getRagClients(
  request: NextRequest,
  options?: {
    requireUserCredentials?: boolean;
    knowledgeBase?: Pick<KnowledgeBase, "visibility">;
  },
) {
  const credentials = resolveRagCredentials(request, options);

  return {
    credentials,
    openai: new OpenAI({ apiKey: credentials.openaiApiKey }),
    qdrant: createQdrantClient(credentials.qdrantUrl, credentials.qdrantApiKey),
  };
}

export function getOpenAIKeyFromCompatRequest(request: NextRequest) {
  const authHeader = request.headers.get("authorization")?.trim();
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    const bearerKey = authHeader.slice(7).trim();
    if (bearerKey) {
      return { apiKey: bearerKey, keyMode: "user" as const };
    }
  }

  return getOpenAIKeyFromRequest(request);
}

export function resolveCompatRagCredentials(
  request: NextRequest,
  knowledgeBase: Pick<KnowledgeBase, "visibility">,
): RagCredentials {
  const openai = getOpenAIKeyFromCompatRequest(request);
  const qdrant = getQdrantCredentialsFromRequest(request);
  const isPrivate = knowledgeBase.visibility === "PRIVATE";

  if (isPrivate) {
    const userOpenAI = openai?.keyMode === "user" ? openai.apiKey : readHeader(request, "x-openai-api-key");
    const userQdrantUrl = readHeader(request, "x-qdrant-url");
    const userQdrantKey = readHeader(request, "x-qdrant-api-key");

    if (!userOpenAI || !userQdrantUrl || !userQdrantKey) {
      throw new ApiError(
        401,
        "Private knowledge bases require Authorization, x-qdrant-url, and x-qdrant-api-key.",
      );
    }

    return {
      openaiApiKey: userOpenAI,
      qdrantUrl: userQdrantUrl,
      qdrantApiKey: userQdrantKey,
      keyMode: "user",
    };
  }

  if (!openai) {
    throw new ApiError(
      401,
      "No OpenAI API key is available. Provide Authorization: Bearer <key> or x-openai-api-key.",
    );
  }

  if (!qdrant) {
    throw new ApiError(
      400,
      "No Qdrant credentials are available. Provide x-qdrant-url and x-qdrant-api-key or configure server defaults.",
    );
  }

  return {
    openaiApiKey: openai.apiKey,
    qdrantUrl: qdrant.url,
    qdrantApiKey: qdrant.apiKey,
    keyMode: openai.keyMode === "user" || qdrant.keyMode === "user" ? "user" : "fallback",
  };
}
