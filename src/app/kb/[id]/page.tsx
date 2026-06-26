import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { WorkspaceLayout } from "@/components/workspace-layout";

export const dynamic = "force-dynamic";

export default async function KnowledgeBasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Fetch all knowledge bases to populate the left panel sidebar list
  const knowledgeBases = await prisma.knowledgeBase.findMany({
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

  // Find the active knowledge base
  const knowledgeBase = knowledgeBases.find((kb) => kb.id === id);

  if (!knowledgeBase) {
    notFound();
  }

  return (
    <WorkspaceLayout
      knowledgeBases={knowledgeBases}
      activeKb={knowledgeBase}
      activeFiles={knowledgeBase.files}
    />
  );
}

