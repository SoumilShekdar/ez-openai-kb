export const APP_NAME = "Knowledge Base Lab";
export const SESSION_COOKIE_NAME = "kb_lab_session";

export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;
export const DEFAULT_QDRANT_SCORE_THRESHOLD = 0.2;
export const DEFAULT_RETRIEVAL_LIMIT = 8;
export const MAX_REMOTE_FILE_BYTES = 50 * 1024 * 1024;
export const REMOTE_FETCH_TIMEOUT_MS = 20_000;

export const DEFAULT_QDRANT_URL =
  "https://728c3995-d04c-4506-97be-7f5c6698f34c.eu-central-1-0.aws.cloud.qdrant.io";

const DEV_SESSION_SECRET = "dev-only-session-secret-change-me";

const PRODUCTION_REQUIRED_ENV_VARS = [
  "SESSION_SECRET",
  "CLERK_SECRET_KEY",
  "DATABASE_URL",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
] as const;

function readEnv(name: string) {
  // Dynamic lookup so Next.js does not inline secrets at build time.
  return process.env[name]?.trim();
}

function isProductionRuntime() {
  return (
    typeof window === "undefined" &&
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  );
}

let productionEnvValidated = false;

function assertProductionEnv() {
  if (!isProductionRuntime() || productionEnvValidated) {
    return;
  }

  productionEnvValidated = true;

  const sessionSecret = readEnv("SESSION_SECRET");
  if (!sessionSecret || sessionSecret === DEV_SESSION_SECRET) {
    throw new Error(
      "SESSION_SECRET must be set to a strong random value in production. Add it in Vercel → Settings → Environment Variables for Production and Preview, then redeploy.",
    );
  }

  const missing = PRODUCTION_REQUIRED_ENV_VARS.filter((key) => !readEnv(key));
  if (missing.length > 0) {
    throw new Error(
      `Missing required production environment variables: ${missing.join(", ")}`,
    );
  }
}

export function getSessionSecret() {
  assertProductionEnv();
  return readEnv("SESSION_SECRET") || DEV_SESSION_SECRET;
}

export function getFallbackOpenAIKey() {
  return readEnv("OPENAI_API_KEY") || null;
}

export function getFallbackQdrantUrl() {
  return readEnv("QDRANT_URL") || DEFAULT_QDRANT_URL;
}

export function getFallbackQdrantApiKey() {
  return readEnv("QDRANT_API_KEY") || null;
}

export function getAllowedQdrantHosts() {
  return (readEnv("QDRANT_ALLOWED_HOSTS") || "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}
