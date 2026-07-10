import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { KeyMode, PrismaClient, UsageEventType } from "@prisma/client";
import { ApiError } from "@/lib/api";
import { getSessionSecret } from "@/lib/env";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function getRateLimitKey(request: NextRequest, userId: string | null, sessionId: string) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const clientAddress = forwarded || request.headers.get("x-real-ip")?.trim();
  const identity = userId ? `user:${userId}` : clientAddress ? `ip:${clientAddress}` : `session:${sessionId}`;
  return createHash("sha256").update(`${getSessionSecret()}:${identity}`).digest("hex");
}

async function reserveUsage({
  prisma,
  sessionId,
  rateLimitKey,
  eventType,
  knowledgeBaseId,
  windows,
}: {
  prisma: PrismaClient;
  sessionId: string;
  rateLimitKey: string;
  eventType: UsageEventType;
  knowledgeBaseId?: string;
  windows: Array<{ duration: number; limit: number; message: string }>;
}) {
  await prisma.$transaction(async (tx) => {
    for (const window of windows) {
      const count = await tx.usageEvent.count({
        where: {
          rateLimitKey,
          eventType,
          isReservation: true,
          createdAt: { gte: new Date(Date.now() - window.duration) },
        },
      });
      if (count >= window.limit) {
        throw new ApiError(429, window.message);
      }
    }

    await tx.usageEvent.create({
      data: {
        sessionId,
        rateLimitKey,
        eventType,
        keyMode: KeyMode.FALLBACK,
        knowledgeBaseId,
        isReservation: true,
      },
    });
  });
}

export async function enforceFallbackRateLimit({
  prisma,
  sessionId,
  rateLimitKey,
  eventType,
  knowledgeBaseId,
}: {
  prisma: PrismaClient;
  sessionId: string;
  rateLimitKey: string;
  eventType: UsageEventType;
  knowledgeBaseId?: string;
}) {
  if (eventType === UsageEventType.FILE_ADD) {
    await reserveUsage({
      prisma, sessionId, rateLimitKey, eventType, knowledgeBaseId,
      windows: [
        { duration: HOUR, limit: 3, message: "Fallback key limit reached. You can add up to 3 files per hour unless you use your own OpenAI key." },
        { duration: DAY, limit: 10, message: "Fallback key daily limit reached. Use your own OpenAI key to add more files." },
      ],
    });
    return;
  }

  await reserveUsage({
    prisma, sessionId, rateLimitKey, eventType, knowledgeBaseId,
    windows: [
      { duration: MINUTE, limit: 3, message: "Fallback key limit reached. Search and chat are limited to 3 requests per minute unless you use your own OpenAI key." },
      { duration: DAY, limit: 100, message: "Fallback key daily limit reached. Use your own OpenAI key to continue." },
    ],
  });
}

export async function enforceWebSearchRateLimit({
  prisma,
  sessionId,
  rateLimitKey,
}: {
  prisma: PrismaClient;
  sessionId: string;
  rateLimitKey: string;
}) {
  await reserveUsage({
    prisma, sessionId, rateLimitKey, eventType: UsageEventType.WEB_SEARCH,
    windows: [
      { duration: MINUTE, limit: 2, message: "Web search is limited to 2 requests per minute." },
      { duration: DAY, limit: 30, message: "Web search daily limit reached. Try again tomorrow." },
    ],
  });
}
