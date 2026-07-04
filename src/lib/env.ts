export const APP_NAME = "Knowledge Base Lab";
export const SESSION_COOKIE_NAME = "kb_lab_session";

export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;
export const DEFAULT_QDRANT_SCORE_THRESHOLD = 0.2;
export const DEFAULT_RETRIEVAL_LIMIT = 8;

export const DEFAULT_QDRANT_URL =
  "https://728c3995-d04c-4506-97be-7f5c6698f34c.eu-central-1-0.aws.cloud.qdrant.io";

const DEV_SESSION_SECRET = "dev-only-session-secret-change-me";

const PRODUCTION_REQUIRED_ENV_VARS = [
  "SESSION_SECRET",
  "CLERK_SECRET_KEY",
  "DATABASE_URL",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_CLERK_SIGN_IN_URL",
  "NEXT_PUBLIC_CLERK_SIGN_UP_URL",
] as const;

function isProductionRuntime() {
  return (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  );
}

function assertProductionEnv() {
  if (!isProductionRuntime()) {
    return;
  }

  const missing = PRODUCTION_REQUIRED_ENV_VARS.filter(
    (key) => !process.env[key]?.trim(),
  );

  const sessionSecret = process.env.SESSION_SECRET?.trim();
  if (!sessionSecret || sessionSecret === DEV_SESSION_SECRET) {
    throw new Error(
      "SESSION_SECRET must be set to a strong random value in production.",
    );
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required production environment variables: ${missing.join(", ")}`,
    );
  }
}

assertProductionEnv();

export const SESSION_SECRET =
  process.env.SESSION_SECRET?.trim() || DEV_SESSION_SECRET;

export function getFallbackOpenAIKey() {
  return process.env.OPENAI_API_KEY?.trim() || null;
}

export function getFallbackQdrantUrl() {
  return process.env.QDRANT_URL?.trim() || DEFAULT_QDRANT_URL;
}

export function getFallbackQdrantApiKey() {
  return process.env.QDRANT_API_KEY?.trim() || null;
}
