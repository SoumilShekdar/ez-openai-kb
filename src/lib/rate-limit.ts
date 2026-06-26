import { KeyMode, PrismaClient, UsageEventType } from "@prisma/client";
import { ApiError } from "@/lib/api";

export async function enforceFallbackRateLimit({
  prisma,
  sessionId,
  eventType,
}: {
  prisma: PrismaClient;
  sessionId: string;
  eventType: UsageEventType;
}) {
  if (eventType === UsageEventType.FILE_ADD) {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const count = await prisma.usageEvent.count({
      where: {
        sessionId,
        eventType: UsageEventType.FILE_ADD,
        keyMode: KeyMode.FALLBACK,
        createdAt: {
          gte: since,
        },
      },
    });

    if (count >= 5) {
      throw new ApiError(
        429,
        "Fallback key limit reached. You can add up to 5 files per hour unless you use your own OpenAI key.",
      );
    }

    return;
  }

  const since = new Date(Date.now() - 60 * 1000);
  const count = await prisma.usageEvent.count({
    where: {
      sessionId,
      eventType: {
        in: [UsageEventType.SEARCH, UsageEventType.CHAT],
      },
      keyMode: KeyMode.FALLBACK,
      createdAt: {
        gte: since,
      },
    },
  });

  if (count >= 1) {
    throw new ApiError(
      429,
      "Fallback key limit reached. Search and chat are limited to 1 request per minute unless you use your own OpenAI key.",
    );
  }
}
