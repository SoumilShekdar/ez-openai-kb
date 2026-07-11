import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ApiError } from "@/lib/api";
import { MAX_REMOTE_FILE_BYTES, REMOTE_FETCH_TIMEOUT_MS } from "@/lib/env";
import {
  getExtension,
  pickPreferredMimeType,
  validateSupportedFile,
} from "@/lib/file-support";

const MAX_REDIRECTS = 5;

function filenameFromDisposition(contentDisposition: string | null) {
  if (!contentDisposition) {
    return null;
  }

  const match =
    contentDisposition.match(/filename\*=UTF-8''([^;]+)/i) ||
    contentDisposition.match(/filename="?([^"]+)"?/i);

  if (!match?.[1]) {
    return null;
  }

  return decodeURIComponent(match[1]);
}

function isBlockedIpv4(a: number, b: number) {
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  return false;
}

function isBlockedIp(ip: string) {
  if (ip === "::" || ip === "::1" || ip === "127.0.0.1" || ip === "0.0.0.0") {
    return true;
  }

  const version = isIP(ip);
  if (version === 4) {
    const [a, b] = ip.split(".").map(Number);
    return isBlockedIpv4(a, b);
  }

  if (version === 6) {
    const normalized = ip.toLowerCase();
    if (normalized === "::1") return true;
    if (normalized.startsWith("fe80:")) return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
    if (normalized.startsWith("ff")) return true;
    if (normalized.startsWith("::ffff:")) {
      const mapped = normalized.slice(7);
      if (isIP(mapped) === 4) {
        return isBlockedIp(mapped);
      }
    }
  }

  return false;
}

export async function assertSafeRemoteUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ApiError(400, "Invalid URL.");
  }

  if (parsed.protocol !== "https:") {
    throw new ApiError(400, "Only HTTPS URLs are supported.");
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw new ApiError(400, "This URL is not allowed.");
  }

  if (isBlockedIp(hostname)) {
    throw new ApiError(400, "This URL is not allowed.");
  }

  const addresses = await lookup(hostname, { all: true });
  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new ApiError(400, "This URL is not allowed.");
    }
  }
}

export async function fetchWithSafeRedirects(url: string, method: "GET" | "HEAD" = "GET") {
  let currentUrl = url;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    await assertSafeRemoteUrl(currentUrl);

    const response = await fetch(currentUrl, {
      method,
      redirect: "manual",
      headers: {
        "user-agent": "Mozilla/5.0 KnowledgeBaseLab/1.0",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new ApiError(400, "Could not follow the redirect for this URL.");
      }

      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    return { response, finalUrl: currentUrl };
  }

  throw new ApiError(400, "Too many redirects while downloading this URL.");
}

async function readResponseBodyWithLimit(response: Response) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REMOTE_FILE_BYTES) {
    throw new ApiError(
      400,
      `Remote file exceeds the ${MAX_REMOTE_FILE_BYTES / (1024 * 1024)} MB limit.`,
    );
  }

  if (!response.body) {
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REMOTE_FILE_BYTES) {
        await reader.cancel();
        throw new ApiError(
          400,
          `Remote file exceeds the ${MAX_REMOTE_FILE_BYTES / (1024 * 1024)} MB limit.`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks);
}

export async function downloadRemoteFile(url: string, fallbackFilename?: string) {
  const { response, finalUrl } = await fetchWithSafeRedirects(url);

  if (!response.ok) {
    throw new ApiError(400, "Could not download the file from the provided URL.");
  }

  const contentType = response.headers.get("content-type");
  const dispositionName = filenameFromDisposition(
    response.headers.get("content-disposition"),
  );
  const urlName =
    fallbackFilename ||
    decodeURIComponent(new URL(finalUrl).pathname.split("/").pop() || "download");
  const finalName = dispositionName || urlName;
  const extension = getExtension(finalName);
  const usableName = extension ? finalName : `${finalName}.pdf`;

  validateSupportedFile(usableName, contentType);

  const buffer = await readResponseBodyWithLimit(response);
  if (!buffer.length) {
    throw new ApiError(400, "The downloaded file was empty.");
  }

  const mimeType = pickPreferredMimeType(usableName, contentType);

  return new File([buffer], usableName, {
    type: mimeType,
  });
}
