import { load } from "cheerio";
import { getExtension } from "@/lib/file-support";

export type ParsedDocument = {
  text: string;
};

export type TextChunk = {
  text: string;
  chunkIndex: number;
};

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 200;

function normalizeWhitespace(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\t/g, " ").replace(/ +/g, " ").trim();
}

function stripHtml(html: string) {
  const $ = load(html);
  $("script, style, noscript").remove();
  return normalizeWhitespace($.text());
}

async function parsePdf(buffer: Buffer) {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return normalizeWhitespace(result.text || "");
  } finally {
    await parser.destroy();
  }
}

export async function parseDocument(
  filename: string,
  mimeType: string | null | undefined,
  buffer: Buffer,
): Promise<ParsedDocument> {
  const extension = getExtension(filename);
  const type = mimeType?.toLowerCase() ?? "";

  if (extension === "pdf" || type.includes("pdf")) {
    const text = await parsePdf(buffer);
    if (!text) {
      throw new Error(`Unable to extract text from "${filename}".`);
    }
    return { text };
  }

  if (
    extension === "html" ||
    type.includes("html") ||
    extension === "htm"
  ) {
    const text = stripHtml(buffer.toString("utf8"));
    if (!text) {
      throw new Error(`Unable to extract text from "${filename}".`);
    }
    return { text };
  }

  const text = normalizeWhitespace(buffer.toString("utf8"));
  if (!text) {
    throw new Error(`"${filename}" appears to be empty or unreadable.`);
  }

  return { text };
}

export function chunkText(text: string): TextChunk[] {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return [];
  }

  const chunks: TextChunk[] = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < normalized.length) {
    const end = Math.min(start + CHUNK_SIZE, normalized.length);
    const slice = normalized.slice(start, end).trim();

    if (slice) {
      chunks.push({ text: slice, chunkIndex });
      chunkIndex += 1;
    }

    if (end >= normalized.length) {
      break;
    }

    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }

  return chunks;
}
