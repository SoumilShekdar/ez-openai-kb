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
  snippet?: string;
};

function unwrapDuckDuckGoHref(href: string) {
  if (!href.startsWith("//duckduckgo.com/l/?") && !href.startsWith("https://duckduckgo.com/l/?")) {
    return href;
  }

  const normalized = href.startsWith("//") ? `https:${href}` : href;
  const url = new URL(normalized);
  return url.searchParams.get("uddg") ?? href;
}

function getQueryTerms(query: string) {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);
}

function scoreSearchLink(link: SearchLink, terms: string[]) {
  if (terms.length === 0) {
    return 1;
  }

  const haystack = `${link.title} ${link.href} ${link.snippet ?? ""}`.toLowerCase();
  return terms.reduce((score, term) => (haystack.includes(term) ? score + 1 : score), 0);
}

function minRelevantScore(terms: string[]) {
  if (terms.length <= 1) {
    return 1;
  }

  // Multi-word queries should not collapse to the first term only.
  return Math.min(terms.length, Math.max(2, Math.ceil(terms.length * 0.75)));
}

function buildPhraseQuery(query: string) {
  const trimmed = query.trim();
  if (!trimmed || /^".*"$/.test(trimmed) || !/\s/.test(trimmed)) {
    return trimmed;
  }

  return `"${trimmed.replaceAll('"', "")}"`;
}

function buildScopedQuery(query: string, domains: string[]) {
  if (domains.length === 0) {
    return query;
  }

  return `${query} ${domains.map((domain) => `site:${domain}`).join(" OR ")}`;
}

function dedupeLinks(links: SearchLink[]) {
  const seen = new Set<string>();
  const unique: SearchLink[] = [];

  for (const link of links) {
    if (!link.href.startsWith("http") || seen.has(link.href)) {
      continue;
    }
    seen.add(link.href);
    unique.push(link);
  }

  return unique;
}

function rankLinks(links: SearchLink[], terms: string[]) {
  const minScore = minRelevantScore(terms);

  return dedupeLinks(links)
    .map((link) => ({ link, score: scoreSearchLink(link, terms) }))
    .filter((item) => item.score >= minScore)
    .sort((a, b) => b.score - a.score || a.link.title.localeCompare(b.link.title))
    .map((item) => item.link);
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
  const searchUrl = new URL("https://www.bing.com/search");
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("format", "rss");

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
      snippet: $(node).find("description").first().text().trim(),
    }))
    .filter((item) => item.href.startsWith("http"));
}

async function searchDuckDuckGoHtml(query: string): Promise<SearchLink[]> {
  const searchUrl = new URL("https://html.duckduckgo.com/html/");
  searchUrl.searchParams.set("q", query);

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
    .map((node) => {
      const result = $(node).closest(".result");
      return {
        title: $(node).text().trim(),
        href: unwrapDuckDuckGoHref($(node).attr("href")?.trim() ?? ""),
        snippet: result.find(".result__snippet").first().text().trim(),
      };
    })
    .filter((item) => item.href.startsWith("http"));
}

async function collectSearchLinks(query: string, domains: string[]) {
  const terms = getQueryTerms(query);
  const phraseQuery = buildScopedQuery(buildPhraseQuery(query), domains);
  const plainQuery = buildScopedQuery(query, domains);
  const queries = phraseQuery === plainQuery ? [plainQuery] : [phraseQuery, plainQuery];

  const collected: SearchLink[] = [];
  let providerReturnedLinks = false;

  for (const scopedQuery of queries) {
    const bingLinks = await searchBingRss(scopedQuery);
    if (bingLinks.length > 0) {
      providerReturnedLinks = true;
      collected.push(...bingLinks);
    }

    let ranked = rankLinks(collected, terms);
    if (ranked.length > 0) {
      return { links: ranked, providerReturnedLinks };
    }

    const duckLinks = await searchDuckDuckGoHtml(scopedQuery);
    if (duckLinks.length > 0) {
      providerReturnedLinks = true;
      collected.push(...duckLinks);
    }

    ranked = rankLinks(collected, terms);
    if (ranked.length > 0) {
      return { links: ranked, providerReturnedLinks };
    }
  }

  return {
    links: rankLinks(collected, terms),
    providerReturnedLinks,
  };
}

export async function searchWebForFiles(query: string, preset = "all") {
  const domains = DOMAIN_PRESETS[preset] ?? [];
  const terms = getQueryTerms(query);
  const { links, providerReturnedLinks } = await collectSearchLinks(query, domains);

  if (links.length === 0) {
    if (!providerReturnedLinks) {
      throw new ApiError(
        503,
        "Web search is temporarily unavailable. Try again in a moment.",
      );
    }

    return [];
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

    // Re-check relevance against the final URL after redirects.
    if (
      terms.length > 1 &&
      scoreSearchLink(
        { title: item.title, href: finalUrl, snippet: item.snippet },
        terms,
      ) < minRelevantScore(terms)
    ) {
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
