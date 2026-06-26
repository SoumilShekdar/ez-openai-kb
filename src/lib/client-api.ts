"use client";

export async function apiRequest<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);

  if (typeof window !== "undefined") {
    const apiKey = window.sessionStorage.getItem("openai_user_key")?.trim();
    if (apiKey) {
      headers.set("x-openai-api-key", apiKey);
    }
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
