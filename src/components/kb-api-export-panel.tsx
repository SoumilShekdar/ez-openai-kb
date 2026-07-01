"use client";

import { useMemo } from "react";
import {
  buildChatCompletionsCurlExample,
  buildChatCompletionsFetchExample,
  CHAT_COMPLETIONS_RESPONSE_EXAMPLE,
} from "@/lib/kb-api-examples";

type KbApiExportPanelProps = {
  kbId: string;
  baseUrl: string;
  onCopied: (message: string) => void;
};

function CodeBlock({
  label,
  code,
  onCopy,
}: {
  label: string;
  code: string;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-xl border border-border-theme bg-background overflow-hidden">
      <div className="flex items-center justify-between border-b border-border-theme bg-card-bg px-3 py-2">
        <span className="text-[11px] font-semibold text-slate-400">{label}</span>
        <button
          type="button"
          onClick={onCopy}
          className="rounded px-2 py-0.5 text-[10px] font-medium text-accent-teal hover:bg-accent-teal/10 transition"
        >
          Copy
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[11px] leading-relaxed text-slate-400 font-mono whitespace-pre-wrap break-all">
        {code}
      </pre>
    </div>
  );
}

export function KbApiExportPanel({ kbId, baseUrl, onCopied }: KbApiExportPanelProps) {
  const curlExample = useMemo(
    () => buildChatCompletionsCurlExample({ baseUrl, kbId }),
    [baseUrl, kbId],
  );
  const fetchExample = useMemo(
    () => buildChatCompletionsFetchExample({ baseUrl, kbId }),
    [baseUrl, kbId],
  );

  const endpoint = `${baseUrl}/v1/chat/completions`;

  function copy(text: string, message: string) {
    void navigator.clipboard.writeText(text);
    onCopied(message);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border-theme bg-background p-4 space-y-3">
        <div>
          <h3 className="text-xs font-semibold text-foreground">Get responses</h3>
          <p className="mt-1 text-[11px] text-slate-500 leading-relaxed">
            Query this knowledge base with an OpenAI-compatible chat completions request.
          </p>
        </div>

        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Endpoint</p>
          <p className="rounded border border-border-theme bg-card-bg px-2.5 py-1.5 font-mono text-[11px] text-foreground break-all">
            POST {endpoint}
          </p>
        </div>

        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Required headers</p>
          <ul className="list-disc pl-4 text-[11px] text-slate-500 space-y-1">
            <li>
              <span className="font-mono text-slate-400">Authorization: Bearer &lt;OPENAI_API_KEY&gt;</span>
              {" "}or{" "}
              <span className="font-mono text-slate-400">x-openai-api-key</span>
            </li>
            <li>
              <span className="font-mono text-slate-400">x-knowledge-base-id: {kbId}</span>
            </li>
          </ul>
        </div>

        <CodeBlock
          label="curl"
          code={curlExample}
          onCopy={() => copy(curlExample, "curl example copied.")}
        />

        <CodeBlock
          label="JavaScript (fetch)"
          code={fetchExample}
          onCopy={() => copy(fetchExample, "fetch example copied.")}
        />
      </div>

      <div className="rounded-xl border border-border-theme bg-background p-4 space-y-3">
        <div>
          <h3 className="text-xs font-semibold text-foreground">Response format</h3>
          <p className="mt-1 text-[11px] text-slate-500 leading-relaxed">
            Returns an OpenAI-style <span className="font-mono">chat.completion</span> object with
            extra fields for grounded citations.
          </p>
        </div>

        <ul className="list-disc pl-4 text-[11px] text-slate-500 space-y-1">
          <li>
            <span className="font-mono text-slate-400">choices[0].message.content</span> — the answer text
          </li>
          <li>
            <span className="font-mono text-slate-400">choices[0].message.annotations</span> — inline file
            citation markers
          </li>
          <li>
            <span className="font-mono text-slate-400">citations</span> — list of source files referenced
          </li>
          <li>
            <span className="font-mono text-slate-400">warning</span> — set when no grounded results were found
          </li>
        </ul>

        <CodeBlock
          label="Sample response"
          code={CHAT_COMPLETIONS_RESPONSE_EXAMPLE}
          onCopy={() => copy(CHAT_COMPLETIONS_RESPONSE_EXAMPLE, "response example copied.")}
        />
      </div>

      <div className="rounded-xl border border-border-theme bg-background p-4 space-y-2">
        <h3 className="text-xs font-semibold text-foreground">Notes</h3>
        <ul className="list-disc pl-4 text-[11px] text-slate-500 space-y-1">
          <li>
            You can pass <span className="font-mono text-slate-400">model: &quot;kb_{kbId}&quot;</span> instead
            of the <span className="font-mono text-slate-400">x-knowledge-base-id</span> header.
          </li>
          <li>
            <span className="font-mono text-slate-400">stream: true</span> is not supported yet and returns{" "}
            <span className="font-mono text-slate-400">501</span>.
          </li>
        </ul>
      </div>
    </div>
  );
}
