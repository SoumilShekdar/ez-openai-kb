"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { KnowledgeBase, KnowledgeFile } from "@prisma/client";
import { apiRequest } from "@/lib/client-api";
import { SettingsPanel } from "@/components/settings-panel";
import { CitationAnswer } from "./citation-answer";

type SearchResult = {
  fileId: string;
  filename: string;
  score: number;
  snippet: string;
  attributes: Record<string, string | number | boolean>;
};

type ChatResult = {
  answer: string;
  citations: Array<{ fileId: string; filename: string; index: number }>;
  annotations?: Array<{ text: string; fileId: string; filename: string; index: number }>;
  warning: string | null;
};

type Candidate = {
  title: string;
  url: string;
  host: string;
  extension: string;
  reason: string;
};

function formatDate(input: Date | string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(input));
}

export function KnowledgeBaseWorkspace({
  knowledgeBase,
  files,
}: {
  knowledgeBase: KnowledgeBase;
  files: KnowledgeFile[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [driveUrl, setDriveUrl] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchWarning, setSearchWarning] = useState<string | null>(null);
  const [chatQuestion, setChatQuestion] = useState("");
  const [chatResult, setChatResult] = useState<ChatResult | null>(null);
  const [webQuery, setWebQuery] = useState("");
  const [webPreset, setWebPreset] = useState("all");
  const [webCandidates, setWebCandidates] = useState<Candidate[]>([]);

  const completedCount = useMemo(
    () => files.filter((file) => file.status === "COMPLETED").length,
    [files],
  );

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
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-8 md:px-10">
      <header className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="rounded-[2.25rem] border border-white/60 bg-[radial-gradient(circle_at_top_left,_rgba(255,214,153,0.32),_transparent_36%),linear-gradient(135deg,_#fbfffd,_#effbf6_54%,_#fef6ea)] p-8 shadow-[0_32px_120px_rgba(19,73,63,0.14)]">
          <Link
            href="/"
            className="text-sm font-medium text-teal-700 transition hover:text-teal-900"
          >
            ← Back to dashboard
          </Link>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">
              {knowledgeBase.sourceMode.toLowerCase()}
            </span>
            <span className="rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-600">
              {completedCount}/{files.length} ready files
            </span>
          </div>
          <h1 className="mt-4 text-5xl font-semibold tracking-[-0.05em] text-slate-950">
            {knowledgeBase.name}
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
            {knowledgeBase.description ||
              "Use this workspace to import grounded sources, inspect indexed files, run retrieval search, and test chat answers with file citations."}
          </p>

          <dl className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-[1.4rem] bg-white/70 p-4">
              <dt className="text-xs uppercase tracking-[0.22em] text-slate-500">
                Vector store
              </dt>
              <dd className="mt-2 truncate font-mono text-sm text-slate-700">
                {knowledgeBase.vectorStoreId}
              </dd>
            </div>
            <div className="rounded-[1.4rem] bg-white/70 p-4">
              <dt className="text-xs uppercase tracking-[0.22em] text-slate-500">
                Updated
              </dt>
              <dd className="mt-2 text-sm text-slate-700">
                {formatDate(knowledgeBase.updatedAt)}
              </dd>
            </div>
            <div className="rounded-[1.4rem] bg-white/70 p-4">
              <dt className="text-xs uppercase tracking-[0.22em] text-slate-500">
                Intended mode
              </dt>
              <dd className="mt-2 text-sm text-slate-700">Single KB chat</dd>
            </div>
          </dl>
        </div>

        <SettingsPanel />
      </header>

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

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-[2rem] border border-white/60 bg-white/85 p-6 shadow-[0_18px_60px_rgba(12,47,41,0.08)]">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
                Files
              </p>
              <h2 className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-slate-950">
                Indexed sources
              </h2>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              {files.length} total
            </span>
          </div>

          <div className="mt-6 space-y-3">
            {files.map((file) => (
              <article
                key={file.id}
                className="rounded-[1.4rem] border border-slate-200 bg-slate-50 px-4 py-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      {file.originalName}
                    </h3>
                    <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                      {file.importSource.toLowerCase()}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      file.status === "COMPLETED"
                        ? "bg-teal-100 text-teal-800"
                        : file.status === "FAILED"
                          ? "bg-rose-100 text-rose-700"
                          : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {file.status.toLowerCase()}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-500">
                  <span>{file.mimeType || "Unknown MIME"}</span>
                  <span>{file.bytes ? `${Math.round(file.bytes / 1024)} KB` : "Size n/a"}</span>
                  <span>{formatDate(file.createdAt)}</span>
                </div>
              </article>
            ))}
          </div>

          {files.length === 0 && (
            <div className="mt-6 rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
              No files yet. Upload from your computer, add a public Google Drive link,
              or pull in a supported file from the web.
            </div>
          )}
        </section>

        <section className="space-y-6">
          <div className="rounded-[2rem] border border-white/60 bg-white/85 p-6 shadow-[0_18px_60px_rgba(12,47,41,0.08)]">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
              Import
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-slate-950">
              Add files to this knowledge base
            </h2>

            <div className="mt-6 space-y-6">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const fileInput = form.elements.namedItem("file") as HTMLInputElement | null;
                  const selectedFile = fileInput?.files?.[0];

                  if (!selectedFile) {
                    setError("Select a file before uploading.");
                    return;
                  }

                  runAction(async () => {
                    const formData = new FormData();
                    formData.set("file", selectedFile);
                    await apiRequest(`/api/knowledge-bases/${knowledgeBase.id}/files/upload`, {
                      method: "POST",
                      body: formData,
                    });
                    setMessage("File uploaded and indexed.");
                    form.reset();
                    router.refresh();
                  });
                }}
                className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Upload from computer
                    </h3>
                    <p className="mt-1 text-sm text-slate-600">
                      PDFs, text, docs, CSV, code, and other OpenAI-supported file types.
                    </p>
                  </div>
                  <button
                    type="submit"
                    disabled={isPending}
                    className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:opacity-60"
                  >
                    Upload
                  </button>
                </div>
                <input
                  name="file"
                  type="file"
                  className="mt-4 block w-full text-sm text-slate-600 file:mr-4 file:rounded-full file:border-0 file:bg-teal-100 file:px-4 file:py-2 file:font-semibold file:text-teal-900"
                />
              </form>

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  runAction(async () => {
                    await apiRequest(`/api/knowledge-bases/${knowledgeBase.id}/files/from-drive-link`, {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ url: driveUrl }),
                    });
                    setMessage("Google Drive file imported.");
                    setDriveUrl("");
                    router.refresh();
                  });
                }}
                className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4"
              >
                <h3 className="text-sm font-semibold text-slate-900">
                  Add from public Google Drive or Google Docs
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  Paste a public Google Drive, Docs, Sheets, or Slides link. Exportable formats are downloaded and added automatically.
                </p>
                <div className="mt-4 flex gap-3">
                  <input
                    value={driveUrl}
                    onChange={(event) => setDriveUrl(event.target.value)}
                    placeholder="https://drive.google.com/..."
                    className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-teal-500"
                  />
                  <button
                    type="submit"
                    disabled={isPending}
                    className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:opacity-60"
                  >
                    Import
                  </button>
                </div>
              </form>

              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-900">
                  Search the web for supported files
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  Useful for open-access medical sources like PubMed Central, WHO, ICMR, and India-specific public guidance.
                </p>

                <div className="mt-4 flex flex-col gap-3 md:flex-row">
                  <input
                    value={webQuery}
                    onChange={(event) => setWebQuery(event.target.value)}
                    placeholder="Search for guidelines, PDFs, papers, or public reports"
                    className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-teal-500"
                  />
                  <select
                    value={webPreset}
                    onChange={(event) => setWebPreset(event.target.value)}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-teal-500"
                  >
                    <option value="all">All domains</option>
                    <option value="pmc">PubMed / NCBI</option>
                    <option value="who">WHO</option>
                    <option value="india">India public health</option>
                    <option value="books">NCBI Bookshelf</option>
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      runAction(async () => {
                        const result = await apiRequest<{
                          candidates: Candidate[];
                        }>("/api/web-files/search", {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({
                            query: webQuery,
                            preset: webPreset,
                          }),
                        });
                        setWebCandidates(result.candidates);
                        setMessage(
                          result.candidates.length
                            ? "Found supported web files."
                            : "No supported file links surfaced for that search.",
                        );
                      })
                    }
                    disabled={isPending}
                    className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:opacity-60"
                  >
                    Search
                  </button>
                </div>

                <div className="mt-5 space-y-3">
                  {webCandidates.map((candidate) => (
                    <article
                      key={candidate.url}
                      className="rounded-[1.25rem] border border-slate-200 bg-white px-4 py-4"
                    >
                      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0">
                          <h4 className="truncate text-sm font-semibold text-slate-900">
                            {candidate.title}
                          </h4>
                          <p className="mt-1 truncate text-xs text-slate-500">
                            {candidate.host} · .{candidate.extension}
                          </p>
                          <p className="mt-2 text-sm text-slate-600">
                            {candidate.reason}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            runAction(async () => {
                              await apiRequest(
                                `/api/knowledge-bases/${knowledgeBase.id}/files/from-web-url`,
                                {
                                  method: "POST",
                                  headers: { "content-type": "application/json" },
                                  body: JSON.stringify({ url: candidate.url }),
                                },
                              );
                              setMessage("Web file imported.");
                              router.refresh();
                            })
                          }
                          className="rounded-full bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-800"
                        >
                          Add file
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/60 bg-white/85 p-6 shadow-[0_18px_60px_rgba(12,47,41,0.08)]">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
              Search
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-slate-950">
              Direct retrieval search
            </h2>
            <div className="mt-4 flex gap-3">
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Find patient safety guidelines, Ayurvedic protocols, or public evidence"
                className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-teal-500"
              />
              <button
                type="button"
                onClick={() =>
                  runAction(async () => {
                    const result = await apiRequest<{ results: SearchResult[] }>(
                      `/api/knowledge-bases/${knowledgeBase.id}/search`,
                      {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ query: searchQuery }),
                      },
                    );
                    setSearchResults(result.results);
                    setSearchWarning(null);
                  })
                }
                disabled={isPending}
                className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:opacity-60"
              >
                Search
              </button>
            </div>

            {searchWarning && (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {searchWarning}
              </div>
            )}

            <div className="mt-5 space-y-3">
              {searchResults.map((result) => (
                <article
                  key={`${result.fileId}-${result.score}`}
                  className="rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-4"
                >
                  <div className="flex items-center justify-between gap-4">
                    <h3 className="text-sm font-semibold text-slate-900">
                      {result.filename}
                    </h3>
                    <span className="text-xs font-semibold text-teal-700">
                      score {result.score.toFixed(2)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {result.snippet}
                  </p>
                </article>
              ))}
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/60 bg-slate-950 p-6 text-white shadow-[0_18px_60px_rgba(8,20,28,0.28)] xl:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-teal-300">
              Chat
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.03em]">
              Ask grounded questions against this KB
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
              The answer is generated with OpenAI file search over this knowledge base only. If no relevant files are found, the app surfaces a warning instead of pretending the source exists.
            </p>

            <div className="mt-5 flex flex-col gap-3 md:flex-row">
              <textarea
                value={chatQuestion}
                onChange={(event) => setChatQuestion(event.target.value)}
                rows={4}
                placeholder="Example: What does this knowledge base say about hypertension management for Indian clinical practice?"
                className="min-h-28 min-w-0 flex-1 rounded-[1.5rem] border border-white/10 bg-white/10 px-4 py-3 text-sm text-white outline-none transition focus:border-teal-400"
              />
              <button
                type="button"
                onClick={() =>
                  runAction(async () => {
                    const result = await apiRequest<ChatResult>(
                      `/api/knowledge-bases/${knowledgeBase.id}/chat`,
                      {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ question: chatQuestion }),
                      },
                    );
                    setChatResult(result);
                    setMessage("Chat answer generated.");
                  })
                }
                disabled={isPending}
                className="rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-teal-100 disabled:opacity-60"
              >
                Ask KB
              </button>
            </div>

            {chatResult?.warning && (
              <div className="mt-5 rounded-2xl border border-amber-350 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900/40 px-4 py-3 text-sm text-amber-900 dark:text-amber-300">
                {chatResult.warning}
              </div>
            )}

            {chatResult && (
              <div className="mt-6 rounded-[1.75rem] bg-white/8 p-5 space-y-4">
                <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-teal-200">
                  Answer
                </h3>
                
                <CitationAnswer
                  answer={chatResult.answer}
                  citations={chatResult.citations}
                  annotations={chatResult.annotations}
                />

                {(!chatResult.citations || chatResult.citations.length === 0) && (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-350 flex gap-2 items-start mt-4">
                    <svg className="h-4.5 w-4.5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div>
                      <span className="font-semibold">Ungrounded Answer:</span> No files were retrieved or searched from the knowledge base for this question.
                    </div>
                  </div>
                )}

                {(chatResult.citations && chatResult.citations.length > 0) && (!chatResult.annotations || chatResult.annotations.length === 0) && (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-350 flex gap-2 items-start mt-4">
                    <svg className="h-4.5 w-4.5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div>
                      <span className="font-semibold">Ungrounded Answer:</span> Although files were retrieved, no grounding citations were used in this response.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
