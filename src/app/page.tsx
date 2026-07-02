import { redirect } from "next/navigation";
import { WorkspaceLayout } from "@/components/workspace-layout";
import {
  getAuthContext,
  listKbWhere,
} from "@/lib/kb-access";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function Home() {
  const authContext = await getAuthContext();
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

  if (knowledgeBases.length > 0) {
    redirect(`/kb/${knowledgeBases[0].id}`);
  }

  return (
    <WorkspaceLayout
      knowledgeBases={[]}
      activeKb={null}
      activeFiles={[]}
      isSignedIn={Boolean(authContext.userId)}
      canWriteActiveKb={false}
    />
  );
}
