import { notFound, redirect } from "next/navigation";
import { WorkspaceLayout } from "@/components/workspace-layout";
import {
  canReadKb,
  canWriteKb,
  getAuthContext,
  listKbWhere,
} from "@/lib/kb-access";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function KnowledgeBasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const authContext = await getAuthContext();

  const knowledgeBase = await prisma.knowledgeBase.findUnique({
    where: { id },
    include: {
      files: {
        orderBy: {
          createdAt: "desc",
        },
      },
    },
  });

  if (!knowledgeBase) {
    notFound();
  }

  if (!canReadKb(knowledgeBase, authContext)) {
    if (!authContext.userId) {
      redirect(`/sign-in?redirect_url=${encodeURIComponent(`/kb/${id}`)}`);
    }

    notFound();
  }

  const knowledgeBases = await prisma.knowledgeBase.findMany({
    where: listKbWhere(authContext),
    include: {
      files: {
        orderBy: {
          createdAt: "desc",
        },
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  return (
    <WorkspaceLayout
      knowledgeBases={knowledgeBases}
      activeKb={knowledgeBase}
      activeFiles={knowledgeBase.files}
      isSignedIn={Boolean(authContext.userId)}
      canWriteActiveKb={canWriteKb(knowledgeBase, authContext)}
    />
  );
}
