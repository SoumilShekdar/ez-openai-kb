import { ApiError } from "@/lib/api";
import {
  getExtension,
  pickPreferredMimeType,
  validateSupportedFile,
} from "@/lib/file-support";

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

export async function downloadRemoteFile(url: string, fallbackFilename?: string) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": "Mozilla/5.0 KnowledgeBaseLab/1.0",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new ApiError(400, `Could not download the file from ${url}.`);
  }

  const contentType = response.headers.get("content-type");
  const dispositionName = filenameFromDisposition(
    response.headers.get("content-disposition"),
  );
  const urlName =
    fallbackFilename ||
    decodeURIComponent(new URL(response.url).pathname.split("/").pop() || "download");
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
