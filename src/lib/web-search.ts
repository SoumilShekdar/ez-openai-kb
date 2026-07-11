import * as cheerio from "cheerio";
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

async function searchBingRss(query: string): Promise<SearchLink[]> {
  const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss`;
  const response = await fetch(searchUrl, {
    headers: {
      ...BROWSER_HEADERS,
      accept: "application/rss+xml, application/xml, text/xml, */*",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return [];
  }

  const xml = await response.text();
  if (!xml.includes("<item>")) {
    return [];
  }

  const $ = cheerio.load(xml, { xml: true });
  return $("item")
    .toArray()
    .map((node) => ({
      title: $(node).find("title").first().text().trim(),
      href: $(node).find("link").first().text().trim(),
    }))
    .filter((item) => item.href.startsWith("http"));
}

async function searchDuckDuckGoHtml(query: string): Promise<SearchLink[]> {
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(searchUrl, {
    headers: BROWSER_HEADERS,
    cache: "no-store",
  });

  if (!response.ok || response.status === 202) {
    return [];
  }

  const html = await response.text();
  if (!html.includes("result__a")) {
    return [];
  }

  const $ = cheerio.load(html);
  return $(".result__a")
    .toArray()
    .map((node) => ({
      title: $(node).text().trim(),
      href: unwrapDuckDuckGoHref($(node).attr("href")?.trim() ?? ""),
    }))
    .filter((item) => item.href.startsWith("http"));
}

export async function searchWebForFiles(query: string, preset = "all") {
  const domains = DOMAIN_PRESETS[preset] ?? [];
  const scopedQuery =
    domains.length > 0
      ? `${query} ${domains.map((domain) => `site:${domain}`).join(" OR ")}`
      : query;

  let links = await searchBingRss(scopedQuery);
  if (links.length === 0) {
    links = await searchDuckDuckGoHtml(scopedQuery);
  }

  if (links.length === 0) {
    throw new ApiError(
      503,
      "Web search is temporarily unavailable. Try again in a moment.",
    );
  }

  const candidates: WebCandidate[] = [];
  const seen = new Set<string>();

  for (const item of links.slice(0, 12)) {
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
