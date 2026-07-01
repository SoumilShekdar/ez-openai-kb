import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api";

export class OpenAICompatError extends Error {
  status: number;
  type: string;
  code: string;

  constructor(status: number, message: string, type = "invalid_request_error", code = "invalid_request") {
    super(message);
    this.status = status;
    this.type = type;
    this.code = code;
  }
}

export function getApiKeyFromCompatRequest(request: NextRequest) {
  const authHeader = request.headers.get("authorization")?.trim();
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    const bearerKey = authHeader.slice(7).trim();
    if (bearerKey) {
      return bearerKey;
    }
  }

  const headerKey = request.headers.get("x-openai-api-key")?.trim();
  if (headerKey) {
    return headerKey;
  }

  const fallbackKey = process.env.OPENAI_API_KEY?.trim();
  if (fallbackKey) {
    return fallbackKey;
  }

  throw new OpenAICompatError(
    401,
    "No OpenAI API key is available. Provide Authorization: Bearer <key> or x-openai-api-key.",
    "authentication_error",
    "invalid_api_key",
  );
}

export function resolveKnowledgeBaseId(request: NextRequest, model?: string) {
  const headerId = request.headers.get("x-knowledge-base-id")?.trim();
  if (headerId) {
    return headerId;
  }

  if (model?.startsWith("kb_")) {
    return model.slice(3);
  }

  throw new OpenAICompatError(
    400,
    "Knowledge base id is required. Set x-knowledge-base-id header or use model=kb_<id>.",
    "invalid_request_error",
    "missing_knowledge_base_id",
  );
}

export function openAICompatErrorResponse(error: unknown) {
  if (error instanceof OpenAICompatError) {
    return NextResponse.json(
      {
        error: {
          message: error.message,
          type: error.type,
          code: error.code,
        },
      },
      { status: error.status },
    );
  }

  if (error instanceof ApiError) {
    return NextResponse.json(
      {
        error: {
          message: error.message,
          type: "invalid_request_error",
          code: "invalid_request",
        },
      },
      { status: error.status },
    );
  }

  console.error(error);
  return NextResponse.json(
    {
      error: {
        message: "Something went wrong while processing the request.",
        type: "server_error",
        code: "internal_error",
      },
    },
    { status: 500 },
  );
}
