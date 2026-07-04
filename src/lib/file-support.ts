const SUPPORTED_FILE_TYPES: Record<string, string[]> = {
  csv: ["text/csv", "application/csv"],
  html: ["text/html"],
  htm: ["text/html"],
  json: ["application/json", "text/json", "text/plain"],
  md: ["text/markdown", "text/x-markdown", "text/plain"],
  pdf: ["application/pdf"],
  txt: ["text/plain"],
};

export type SupportedFile = {
  extension: string;
  mimeType: string;
};

export function getExtension(filename: string) {
  const cleanName = filename.split("?")[0]?.split("#")[0] ?? filename;
  const extension = cleanName.split(".").pop()?.toLowerCase();
  return extension || "";
}

export function isSupportedFile(filename: string, mimeType?: string | null) {
  const extension = getExtension(filename);
  const supportedTypes = SUPPORTED_FILE_TYPES[extension];

  if (!supportedTypes) {
    return false;
  }

  if (!mimeType) {
    return true;
  }

  return supportedTypes.includes(mimeType.toLowerCase()) || mimeType.startsWith("text/");
}

export function validateSupportedFile(filename: string, mimeType?: string | null) {
  if (!isSupportedFile(filename, mimeType)) {
    throw new Error(
      `Unsupported file type for "${filename}". Upload PDF, plain text, Markdown, JSON, CSV, or HTML.`,
    );
  }
}

export function pickPreferredMimeType(filename: string, mimeType?: string | null) {
  if (mimeType) {
    return mimeType;
  }

  const extension = getExtension(filename);
  return SUPPORTED_FILE_TYPES[extension]?.[0] ?? "application/octet-stream";
}

export function getSupportedExtensions() {
  return Object.keys(SUPPORTED_FILE_TYPES).sort();
}

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
