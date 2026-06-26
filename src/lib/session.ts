import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, SESSION_SECRET } from "@/lib/env";

export type SessionState = {
  sessionId: string;
  cookieValue: string;
  shouldSetCookie: boolean;
};

function signSessionId(sessionId: string) {
  return createHmac("sha256", SESSION_SECRET).update(sessionId).digest("hex");
}

function buildCookieValue(sessionId: string) {
  return `${sessionId}.${signSessionId(sessionId)}`;
}

function verifyCookieValue(cookieValue?: string) {
  if (!cookieValue) {
    return null;
  }

  const [sessionId, signature] = cookieValue.split(".");
  if (!sessionId || !signature) {
    return null;
  }

  const expected = signSessionId(sessionId);
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) {
    return null;
  }

  if (!timingSafeEqual(providedBuffer, expectedBuffer)) {
    return null;
  }

  return sessionId;
}

export function getSessionState(request: NextRequest): SessionState {
  const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const existingSessionId = verifyCookieValue(cookieValue);

  if (existingSessionId) {
    return {
      sessionId: existingSessionId,
      cookieValue: buildCookieValue(existingSessionId),
      shouldSetCookie: false,
    };
  }

  const sessionId = crypto.randomUUID();
  return {
    sessionId,
    cookieValue: buildCookieValue(sessionId),
    shouldSetCookie: true,
  };
}

export function applySessionCookie(
  response: NextResponse,
  sessionState: SessionState,
) {
  if (!sessionState.shouldSetCookie) {
    return response;
  }

  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: sessionState.cookieValue,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}
