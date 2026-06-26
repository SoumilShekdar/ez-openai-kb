import * as cheerio from "cheerio";
import { getExtension, isSupportedFile } from "@/lib/file-support";

const DOMAIN_PRESETS: Record<string, string[]> = {
  all: [],
  pmc: ["pmc.ncbi.nlm.nih.gov", "ncbi.nlm.nih.gov"],
  who: ["who.int"],
  india: ["icmr.gov.in", "mohfw.gov.in", "nhm.gov.in", "nmc.org.in"],
  books: ["ncbi.nlm.nih.gov"],
};

export type WebCandidate = {
  title: string;
  url: string;
  host: string;
  extension: string;
  reason: string;
};

function unwrapDuckDuckGoHref(href: string) {
  if (!href.startsWith("//duckduckgo.com/l/?") && !href.startsWith("https://duckduckgo.com/l/?")) {
    return href;
  }

  const normalized = href.startsWith("//") ? `https:${href}` : href;
  const url = new URL(normalized);
  return url.searchParams.get("uddg") ?? href;
}

async function inspectCandidate(url: string) {
  try {
    const headResponse = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 KnowledgeBaseLab/1.0",
      },
      cache: "no-store",
    });

    const finalUrl = headResponse.url || url;
    const contentType = headResponse.headers.get("content-type");
    return { finalUrl, contentType };
  } catch {
    return { finalUrl: url, contentType: null };
  }
}

export async function searchWebForFiles(query: string, preset = "all") {
  const domains = DOMAIN_PRESETS[preset] ?? [];
  const scopedQuery =
    domains.length > 0
      ? `${query} ${domains.map((domain) => `site:${domain}`).join(" OR ")}`
      : query;

  const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(scopedQuery)}`;
  const response = await fetch(searchUrl, {
    headers: {
      "user-agent": "Mozilla/5.0 KnowledgeBaseLab/1.0",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Web search is temporarily unavailable.");
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const links = $(".result__a")
    .toArray()
    .map((node) => ({
      title: $(node).text().trim(),
      href: $(node).attr("href")?.trim() ?? "",
    }))
    .filter((item) => item.href);

  const candidates: WebCandidate[] = [];
  const seen = new Set<string>();

  for (const item of links.slice(0, 12)) {
    const rawUrl = unwrapDuckDuckGoHref(item.href);
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      continue;
    }

    const inspected = await inspectCandidate(parsed.toString());
    const finalUrl = inspected.finalUrl;
    const extension = getExtension(finalUrl || parsed.pathname);
    const host = new URL(finalUrl).hostname.replace(/^www\./, "");
    const supported = isSupportedFile(finalUrl, inspected.contentType);

    if (!supported || seen.has(finalUrl)) {
      continue;
    }

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
