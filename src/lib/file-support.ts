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

export function normalizeMimeType(mimeType?: string | null) {
  return mimeType?.split(";")[0]?.trim().toLowerCase() || null;
}

export function extensionFromMimeType(mimeType?: string | null) {
  const mime = normalizeMimeType(mimeType);
  if (!mime) {
    return "";
  }

  const preferred: Record<string, string> = {
    "application/csv": "csv",
    "application/json": "json",
    "application/pdf": "pdf",
    "text/csv": "csv",
    "text/html": "html",
    "text/json": "json",
    "text/markdown": "md",
    "text/plain": "txt",
    "text/x-markdown": "md",
  };

  return preferred[mime] ?? "";
}

export function isSupportedFile(filename: string, mimeType?: string | null) {
  const extension = getExtension(filename);
  const supportedTypes = SUPPORTED_FILE_TYPES[extension];
  const mime = normalizeMimeType(mimeType);

  if (supportedTypes) {
    if (!mime) {
      return true;
    }

    return supportedTypes.includes(mime) || mime.startsWith("text/");
  }

  // URLs often omit a file extension; allow by content type alone.
  if (!mime) {
    return false;
  }

  return Object.values(SUPPORTED_FILE_TYPES).some((types) => types.includes(mime));
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
