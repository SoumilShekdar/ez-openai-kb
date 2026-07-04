import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ApiError } from "@/lib/api";
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
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isBlockedIp(ip: string) {
  if (ip === "::1" || ip === "127.0.0.1" || ip === "0.0.0.0") {
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
    if (normalized.startsWith("::ffff:")) {
      const mapped = normalized.slice(7);
      if (isIP(mapped) === 4) {
        return isBlockedIp(mapped);
      }
    }
  }

  return false;
}

async function assertSafeRemoteUrl(url: string) {
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

async function fetchWithSafeRedirects(url: string) {
  let currentUrl = url;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    await assertSafeRemoteUrl(currentUrl);

    const response = await fetch(currentUrl, {
      redirect: "manual",
      headers: {
        "user-agent": "Mozilla/5.0 KnowledgeBaseLab/1.0",
      },
      cache: "no-store",
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

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) {
    throw new ApiError(400, "The downloaded file was empty.");
  }

  const mimeType = pickPreferredMimeType(usableName, contentType);

  return new File([buffer], usableName, {
    type: mimeType,
  });
}
