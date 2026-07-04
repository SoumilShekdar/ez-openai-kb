"use client";

const OPENAI_KEY_STORAGE = "openai_user_key";
const QDRANT_URL_STORAGE = "qdrant_user_url";
const QDRANT_API_KEY_STORAGE = "qdrant_user_api_key";

export function getStoredRagCredentials() {
  if (typeof window === "undefined") {
    return {
      openaiApiKey: "",
      qdrantUrl: "",
      qdrantApiKey: "",
    };
  }

  return {
    openaiApiKey: window.sessionStorage.getItem(OPENAI_KEY_STORAGE)?.trim() || "",
    qdrantUrl: window.sessionStorage.getItem(QDRANT_URL_STORAGE)?.trim() || "",
    qdrantApiKey: window.sessionStorage.getItem(QDRANT_API_KEY_STORAGE)?.trim() || "",
  };
}

export function saveStoredRagCredentials({
  openaiApiKey,
  qdrantUrl,
  qdrantApiKey,
}: {
  openaiApiKey: string;
  qdrantUrl: string;
  qdrantApiKey: string;
}) {
  if (typeof window === "undefined") {
    return;
  }

  if (openaiApiKey.trim()) {
    window.sessionStorage.setItem(OPENAI_KEY_STORAGE, openaiApiKey.trim());
  } else {
    window.sessionStorage.removeItem(OPENAI_KEY_STORAGE);
  }

  if (qdrantUrl.trim()) {
    window.sessionStorage.setItem(QDRANT_URL_STORAGE, qdrantUrl.trim());
  } else {
    window.sessionStorage.removeItem(QDRANT_URL_STORAGE);
  }

  if (qdrantApiKey.trim()) {
    window.sessionStorage.setItem(QDRANT_API_KEY_STORAGE, qdrantApiKey.trim());
  } else {
    window.sessionStorage.removeItem(QDRANT_API_KEY_STORAGE);
  }
}

export async function apiRequest<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  const credentials = getStoredRagCredentials();

  if (credentials.openaiApiKey) {
    headers.set("x-openai-api-key", credentials.openaiApiKey);
  }

  if (credentials.qdrantUrl) {
    headers.set("x-qdrant-url", credentials.qdrantUrl);
  }

  if (credentials.qdrantApiKey) {
    headers.set("x-qdrant-api-key", credentials.qdrantApiKey);
  }

  const response = await fetch(input, {
    ...init,
    headers,
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload as T;
}
