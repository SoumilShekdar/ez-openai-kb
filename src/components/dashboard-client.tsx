"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { KnowledgeBase, KnowledgeFile } from "@prisma/client";
import { apiRequest } from "@/lib/client-api";
import { SettingsPanel } from "@/components/settings-panel";

type KnowledgeBaseWithFiles = KnowledgeBase & {
  files: KnowledgeFile[];
};

function formatDate(input: Date | string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(input));
}

export function DashboardClient({
  knowledgeBases,
}: {
  knowledgeBases: KnowledgeBaseWithFiles[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [attachId, setAttachId] = useState("");
  const [attachName, setAttachName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function runAction(action: () => Promise<void>) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      try {
        await action();
      } catch (caughtError) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Something went wrong.",
        );
      }
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-6 py-10 md:px-10">
      <section className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="overflow-hidden rounded-[2.25rem] border border-white/60 bg-[radial-gradient(circle_at_top_left,_rgba(87,181,160,0.24),_transparent_42%),linear-gradient(135deg,_#fef9ef,_#eefbf8_58%,_#f2f8ff)] p-8 shadow-[0_32px_120px_rgba(16,59,51,0.16)]">
          <p className="text-xs font-semibold uppercase tracking-[0.34em] text-teal-700">
            Knowledge Base Lab
          </p>
          <h1 className="mt-4 max-w-3xl text-5xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-6xl">
            Experiment with grounded medical answers, one vector store at a time.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
            Create a fresh knowledge base, attach an existing OpenAI vector store,
            upload files from your machine or public sources, and test search plus
            chat with visible citations.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <div className="rounded-[1.5rem] bg-white/70 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">
                Knowledge bases
              </p>
              <p className="mt-3 text-3xl font-semibold text-slate-900">
                {knowledgeBases.length}
              </p>
            </div>
            <div className="rounded-[1.5rem] bg-white/70 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">
                Indexed files
              </p>
              <p className="mt-3 text-3xl font-semibold text-slate-900">
                {knowledgeBases.reduce((sum, kb) => sum + kb.files.length, 0)}
              </p>
            </div>
            <div className="rounded-[1.5rem] bg-white/70 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">
                Default mode
              </p>
              <p className="mt-3 text-lg font-semibold text-slate-900">
                Single KB chat
              </p>
            </div>
          </div>
        </div>

        <SettingsPanel />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            runAction(async () => {
              const result = await apiRequest<{ knowledgeBase: KnowledgeBase }>(
                "/api/knowledge-bases/create",
                {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    name: createName,
                    description: createDescription || null,
                  }),
                },
              );

              setMessage("Knowledge base created.");
              setCreateName("");
              setCreateDescription("");
              router.push(`/kb/${result.knowledgeBase.id}`);
              router.refresh();
            });
          }}
          className="rounded-[2rem] border border-white/60 bg-white/80 p-6 shadow-[0_24px_80px_rgba(14,48,42,0.08)]"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-700">
            Create
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-slate-950">
            New knowledge base
          </h2>
          <div className="mt-5 space-y-4">
            <input
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              placeholder="Ayurveda Desk"
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-teal-500"
            />
            <textarea
              value={createDescription}
              onChange={(event) => setCreateDescription(event.target.value)}
              placeholder="What this KB is for, audience, or scope notes."
              rows={4}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-teal-500"
            />
          </div>
          <button
            type="submit"
            disabled={isPending}
            className="mt-5 rounded-full bg-teal-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:opacity-60"
          >
            {isPending ? "Creating..." : "Create Knowledge Base"}
          </button>
        </form>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            runAction(async () => {
              const result = await apiRequest<{ knowledgeBase: KnowledgeBase }>(
                "/api/knowledge-bases/attach",
                {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    vectorStoreId: attachId,
                    name: attachName || null,
                  }),
                },
              );

              setMessage("Attached existing vector store.");
              setAttachId("");
              setAttachName("");
              router.push(`/kb/${result.knowledgeBase.id}`);
              router.refresh();
            });
          }}
          className="rounded-[2rem] border border-white/60 bg-slate-950 p-6 text-white shadow-[0_24px_80px_rgba(5,18,24,0.2)]"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-teal-300">
            Attach
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-[-0.03em]">
            Existing OpenAI vector store
          </h2>
          <div className="mt-5 space-y-4">
            <input
              value={attachId}
              onChange={(event) => setAttachId(event.target.value)}
              placeholder="vs_123..."
              className="w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white outline-none transition focus:border-teal-400"
            />
            <input
              value={attachName}
              onChange={(event) => setAttachName(event.target.value)}
              placeholder="Optional display name"
              className="w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white outline-none transition focus:border-teal-400"
            />
          </div>
          <button
            type="submit"
            disabled={isPending}
            className="mt-5 rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-teal-100 disabled:opacity-60"
          >
            {isPending ? "Attaching..." : "Attach Knowledge Base"}
          </button>
        </form>
      </section>

      {(error || message) && (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            error
              ? "border-rose-200 bg-rose-50 text-rose-700"
              : "border-teal-200 bg-teal-50 text-teal-800"
          }`}
        >
          {error || message}
        </div>
      )}

      <section>
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
              Dashboard
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-slate-950">
              Your knowledge bases
            </h2>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
          {knowledgeBases.map((knowledgeBase) => (
            <article
              key={knowledgeBase.id}
              className="rounded-[2rem] border border-white/70 bg-white/80 p-6 shadow-[0_18px_48px_rgba(15,40,35,0.08)]"
            >
              <div className="flex items-center justify-between gap-4">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">
                  {knowledgeBase.sourceMode.toLowerCase()}
                </span>
                <span className="text-xs text-slate-500">
                  {knowledgeBase.files.length} files
                </span>
              </div>
              <h3 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-slate-950">
                {knowledgeBase.name}
              </h3>
              <p className="mt-2 min-h-12 text-sm leading-6 text-slate-600">
                {knowledgeBase.description || "No description yet."}
              </p>
              <dl className="mt-5 space-y-2 text-sm text-slate-600">
                <div className="flex justify-between gap-4">
                  <dt>Vector store</dt>
                  <dd className="max-w-[12rem] truncate font-mono text-xs text-slate-500">
                    {knowledgeBase.vectorStoreId}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Updated</dt>
                  <dd>{formatDate(knowledgeBase.updatedAt)}</dd>
                </div>
              </dl>
              <Link
                href={`/kb/${knowledgeBase.id}`}
                className="mt-6 inline-flex rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800"
              >
                Open Workspace
              </Link>
            </article>
          ))}
        </div>

        {knowledgeBases.length === 0 && (
          <div className="rounded-[2rem] border border-dashed border-slate-300 bg-white/60 p-10 text-center text-slate-500">
            No knowledge bases yet. Create one or attach an existing vector store to get started.
          </div>
        )}
      </section>
    </div>
  );
}
