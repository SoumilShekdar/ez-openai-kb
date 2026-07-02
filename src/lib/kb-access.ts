import type { KnowledgeBase, KbVisibility, Prisma } from "@prisma/client";
import { auth } from "@clerk/nextjs/server";
import { ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const PUBLIC_KB_NAMES = [
  "Clinical Trials: Cancer",
  "Aneurysms",
  "Clinical Trials: Stroke",
  "Ayurvedic Primary Care",
] as const;

export type KbAccessContext = {
  userId: string | null;
};

export async function getAuthContext(): Promise<KbAccessContext> {
  const { userId } = await auth();
  return { userId: userId ?? null };
}

export function canReadKb(kb: Pick<KnowledgeBase, "visibility" | "ownerId">, ctx: KbAccessContext) {
  if (kb.visibility === "PUBLIC") {
    return true;
  }

  return kb.ownerId !== null && kb.ownerId === ctx.userId;
}

export function canWriteKb(kb: Pick<KnowledgeBase, "ownerId">, ctx: KbAccessContext) {
  return ctx.userId !== null && kb.ownerId !== null && kb.ownerId === ctx.userId;
}

export function listKbWhere(ctx: KbAccessContext): Prisma.KnowledgeBaseWhereInput {
  if (!ctx.userId) {
    return { visibility: "PUBLIC" };
  }

  return {
    OR: [{ visibility: "PUBLIC" }, { ownerId: ctx.userId }],
  };
}

export function requireReadKb(
  kb: Pick<KnowledgeBase, "visibility" | "ownerId">,
  ctx: KbAccessContext,
) {
  if (kb.visibility === "PUBLIC") {
    return;
  }

  if (!ctx.userId) {
    throw new ApiError(401, "Sign in to access this private knowledge base.");
  }

  if (kb.ownerId !== ctx.userId) {
    throw new ApiError(403, "You do not have access to this knowledge base.");
  }
}

export function requireWriteKb(kb: Pick<KnowledgeBase, "ownerId">, ctx: KbAccessContext) {
  if (!ctx.userId) {
    throw new ApiError(401, "Sign in to modify knowledge bases.");
  }

  if (!canWriteKb(kb, ctx)) {
    throw new ApiError(403, "You do not have permission to modify this knowledge base.");
  }
}

export async function requireReadableKnowledgeBase(id: string, ctx: KbAccessContext) {
  const kb = await prisma.knowledgeBase.findUnique({
    where: { id },
  });

  if (!kb) {
    throw new ApiError(404, "Knowledge base not found.");
  }

  requireReadKb(kb, ctx);
  return kb;
}

export async function requireWritableKnowledgeBase(id: string, ctx: KbAccessContext) {
  const kb = await requireReadableKnowledgeBase(id, ctx);
  requireWriteKb(kb, ctx);
  return kb;
}

export async function requireAuthenticatedUserId() {
  const ctx = await getAuthContext();

  if (!ctx.userId) {
    throw new ApiError(401, "Sign in to continue.");
  }

  return ctx.userId;
}

export function isPublicKb(kb: Pick<KnowledgeBase, "visibility">) {
  return kb.visibility === "PUBLIC";
}

export type { KbVisibility };
