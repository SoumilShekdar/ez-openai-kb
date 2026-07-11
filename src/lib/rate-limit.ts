import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { KeyMode, UsageEventType } from "@prisma/client";
import { ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Soft ceilings for shared server keys. Sized so a real person exploring the
 * workspace will not notice, while sustained bot traffic still gets cut off.
 */
const LIMITS = {
  retrieval: [
    {
      duration: MINUTE,
      limit: 40,
      message:
        "Shared key limit reached. Search and chat are limited to 40 requests per minute on the server key — add your own OpenAI key in settings to continue.",
    },
    {
      duration: HOUR,
      limit: 300,
      message:
        "Shared key hourly limit reached for search/chat. Add your own OpenAI key in settings to continue.",
    },
    {
      duration: DAY,
      limit: 1500,
      message:
        "Shared key daily limit reached for search/chat. Add your own OpenAI key in settings to continue.",
    },
  ],
  fileAdd: [
    {
      duration: HOUR,
      limit: 30,
      message:
        "Shared key limit reached. You can add up to 30 files per hour on the server key — add your own OpenAI key in settings to continue.",
    },
    {
      duration: DAY,
      limit: 100,
      message:
        "Shared key daily file limit reached. Add your own OpenAI key in settings to continue.",
    },
  ],
  webSearch: [
    {
      duration: MINUTE,
      limit: 30,
      message:
        "Shared key limit reached. Web search is limited to 30 requests per minute on the server key — add your own OpenAI key in settings to continue.",
    },
    {
      duration: HOUR,
      limit: 200,
      message:
        "Shared key hourly web-search limit reached. Add your own OpenAI key in settings to continue.",
    },
    {
      duration: DAY,
      limit: 800,
      message:
        "Shared key daily web-search limit reached. Add your own OpenAI key in settings to continue.",
    },
  ],
  /** Same-instance burst shield against cookie-rotating bots. */
  ipBurstPerMinute: 80,
} as const;

type Window = {
  duration: number;
  limit: number;
  message: string;
};

const ipBurstBuckets = new Map<string, number[]>();

function isFallbackKeyMode(keyMode: KeyMode | "user" | "fallback") {
  return keyMode === KeyMode.FALLBACK || keyMode === "fallback";
}

function getClientIp(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || null;
}

function hashIp(ip: string) {
  return createHash("sha256").update(ip).digest("hex").slice(0, 24);
}

function enforceIpBurst(request: NextRequest) {
  const ip = getClientIp(request);
  if (!ip) {
    return;
  }

  const key = hashIp(ip);
  const now = Date.now();
  const recent = (ipBurstBuckets.get(key) ?? []).filter((ts) => now - ts < MINUTE);
  if (recent.length >= LIMITS.ipBurstPerMinute) {
    throw new ApiError(
      429,
      "Too many requests from this network on the shared server keys. Slow down or add your own OpenAI key in settings.",
    );
  }

  recent.push(now);
  ipBurstBuckets.set(key, recent);

  // Bound memory on long-lived instances.
  if (ipBurstBuckets.size > 5_000) {
    for (const [bucketKey, stamps] of ipBurstBuckets) {
      const live = stamps.filter((ts) => now - ts < MINUTE);
      if (live.length === 0) {
        ipBurstBuckets.delete(bucketKey);
      } else {
        ipBurstBuckets.set(bucketKey, live);
      }
    }
  }
}

async function enforceWindows({
  sessionId,
  eventTypes,
  windows,
}: {
  sessionId: string;
  eventTypes: UsageEventType[];
  windows: readonly Window[];
}) {
  for (const window of windows) {
    const count = await prisma.usageEvent.count({
      where: {
        sessionId,
        keyMode: KeyMode.FALLBACK,
        eventType: { in: [...eventTypes] },
        createdAt: { gte: new Date(Date.now() - window.duration) },
      },
    });

    if (count >= window.limit) {
      throw new ApiError(429, window.message);
    }
  }
}

export async function enforceFallbackRateLimit({
  request,
  sessionId,
  eventType,
  keyMode,
}: {
  request: NextRequest;
  sessionId: string;
  eventType: UsageEventType;
  keyMode: KeyMode | "user" | "fallback";
}) {
  if (!isFallbackKeyMode(keyMode)) {
    return;
  }

  enforceIpBurst(request);

  if (eventType === UsageEventType.FILE_ADD) {
    await enforceWindows({
      sessionId,
      eventTypes: [UsageEventType.FILE_ADD],
      windows: LIMITS.fileAdd,
    });
    return;
  }

  if (eventType === UsageEventType.WEB_SEARCH) {
    await enforceWindows({
      sessionId,
      eventTypes: [UsageEventType.WEB_SEARCH],
      windows: LIMITS.webSearch,
    });
    return;
  }

  await enforceWindows({
    sessionId,
    eventTypes: [UsageEventType.SEARCH, UsageEventType.CHAT],
    windows: LIMITS.retrieval,
  });
}
