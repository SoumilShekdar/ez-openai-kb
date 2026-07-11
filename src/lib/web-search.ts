import type OpenAI from "openai";
import { ApiError } from "@/lib/api";
import {
  extensionFromMimeType,
  getExtension,
  getSupportedExtensions,
  isSupportedFile,
} from "@/lib/file-support";

const DOMAIN_PRESETS: Record<string, string[]> = {
  all: [],
  pmc: ["pmc.ncbi.nlm.nih.gov", "ncbi.nlm.nih.gov"],
  who: ["who.int"],
  india: ["icmr.gov.in", "mohfw.gov.in", "nhm.gov.in", "nmc.org.in"],
  books: ["ncbi.nlm.nih.gov"],
};

const BROWSER_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};

const WEB_SEARCH_MODEL = "gpt-4.1-mini";

export type WebCandidate = {
  title: string;
  url: string;
  host: string;
  extension: string;
  reason: string;
};

type SearchLink = {
  title: string;
  href: string;
};

function cleanSearchUrl(href: string) {
  try {
    const url = new URL(href);
    url.searchParams.delete("utm_source");
    url.searchParams.delete("utm_medium");
    url.searchParams.delete("utm_campaign");
    return url.toString();
  } catch {
    return href;
  }
}

function hostMatchesDomains(href: string, domains: string[]) {
  if (domains.length === 0) {
    return true;
  }

  try {
    const host = new URL(href).hostname.replace(/^www\./, "").toLowerCase();
    return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

async function inspectCandidate(url: string) {
  try {
    const headResponse = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: BROWSER_HEADERS,
      cache: "no-store",
    });

    const finalUrl = headResponse.url || url;
    const contentType = headResponse.headers.get("content-type");
    return { finalUrl, contentType };
  } catch {
    return { finalUrl: url, contentType: null };
  }
}

function buildSearchPrompt(query: string, domains: string[]) {
  const scope =
    domains.length > 0
      ? `Only use sources from these domains: ${domains.join(", ")}.`
      : "Prefer authoritative primary sources.";

  return [
    `Find publicly accessible downloadable documents about: ${query}`,
    scope,
    "Prefer PDF, HTML articles, plain text, Markdown, CSV, or JSON files.",
    "Return a concise list of the best matching file or article URLs with titles.",
    "Do not invent URLs. Use web search.",
  ].join("\n");
}

function collectLinksFromResponse(response: {
  output?: unknown[];
  output_text?: string;
}): SearchLink[] {
  const links = new Map<string, SearchLink>();

  const addLink = (href: string, title?: string) => {
    const cleaned = cleanSearchUrl(href.trim());
    if (!cleaned.startsWith("http") || links.has(cleaned)) {
      return;
    }
    links.set(cleaned, {
      href: cleaned,
      title: title?.trim() || cleaned,
    });
  };

  for (const item of response.output ?? []) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as Record<string, unknown>;

    if (record.type === "web_search_call") {
      const action = record.action as Record<string, unknown> | undefined;
      const sources = action?.sources;
      if (Array.isArray(sources)) {
        for (const source of sources) {
          if (!source || typeof source !== "object") {
            continue;
          }
          const url = (source as { url?: string }).url;
          if (url) {
            addLink(url);
          }
        }
      }
    }

    if (record.type === "message" && Array.isArray(record.content)) {
      for (const part of record.content) {
        if (!part || typeof part !== "object") {
          continue;
        }
        const content = part as {
          annotations?: Array<{ type?: string; url?: string; title?: string }>;
        };
        for (const annotation of content.annotations ?? []) {
          if (annotation.type === "url_citation" && annotation.url) {
            addLink(annotation.url, annotation.title);
          }
        }
      }
    }
  }

  const text = response.output_text ?? "";
  for (const match of text.matchAll(/https?:\/\/[^\s)\]>"']+/g)) {
    addLink(match[0].replace(/[.,;:]+$/, ""));
  }

  return [...links.values()];
}

async function searchWithOpenAI(client: OpenAI, query: string, domains: string[]) {
  const tool: {
    type: "web_search";
    search_context_size: "medium";
    filters?: { allowed_domains: string[] };
  } = {
    type: "web_search",
    search_context_size: "medium",
  };

  if (domains.length > 0) {
    tool.filters = { allowed_domains: domains };
  }

  try {
    const response = await client.responses.create({
      model: WEB_SEARCH_MODEL,
      tools: [tool],
      tool_choice: "required",
      include: ["web_search_call.action.sources"],
      input: buildSearchPrompt(query, domains),
    });

    return collectLinksFromResponse(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenAI web search failed.";
    throw new ApiError(502, `OpenAI web search failed: ${message}`);
  }
}

export async function searchWebForFiles(
  query: string,
  preset = "all",
  openaiClient: OpenAI,
) {
  const domains = DOMAIN_PRESETS[preset] ?? [];
  const links = await searchWithOpenAI(openaiClient, query, domains);

  if (links.length === 0) {
    return [];
  }

  const candidates: WebCandidate[] = [];
  const seen = new Set<string>();

  for (const item of links.slice(0, 12)) {
    if (!hostMatchesDomains(item.href, domains)) {
      continue;
    }

    let parsed: URL;
    try {
      parsed = new URL(item.href);
    } catch {
      continue;
    }

    const inspected = await inspectCandidate(parsed.toString());
    const finalUrl = inspected.finalUrl;

    let host: string;
    try {
      host = new URL(finalUrl).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }

    if (!hostMatchesDomains(finalUrl, domains)) {
      continue;
    }

    const supported = isSupportedFile(finalUrl, inspected.contentType);
    if (!supported || seen.has(finalUrl)) {
      continue;
    }

    const knownExtensions = new Set(getSupportedExtensions());
    const rawExtension = getExtension(finalUrl || parsed.pathname);
    const extension =
      (knownExtensions.has(rawExtension) ? rawExtension : "") ||
      extensionFromMimeType(inspected.contentType) ||
      "html";

    seen.add(finalUrl);
    candidates.push({
      title: item.title || finalUrl,
      url: finalUrl,
      host,
      extension,
      reason: inspected.contentType
        ? `Matched supported content type ${inspected.contentType}`
        : `Matched supported .${extension} file extension`,
    });
  }

  return candidates;
}

export function getDomainPresetOptions() {
  return Object.keys(DOMAIN_PRESETS);
}
