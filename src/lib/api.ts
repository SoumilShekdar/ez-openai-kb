import { NextResponse } from "next/server";
import type { SessionState } from "@/lib/session";
import { applySessionCookie } from "@/lib/session";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function jsonWithSession(
  sessionState: SessionState,
  payload: unknown,
  init?: ResponseInit,
) {
  const response = NextResponse.json(payload, init);
  return applySessionCookie(response, sessionState);
}

export function errorResponse(
  sessionState: SessionState,
  error: unknown,
) {
  if (error instanceof ApiError) {
    return jsonWithSession(
      sessionState,
      { error: error.message },
      { status: error.status },
    );
  }

  console.error(error);
  return jsonWithSession(
    sessionState,
    { error: "Something went wrong while processing the request." },
    { status: 500 },
  );
}
