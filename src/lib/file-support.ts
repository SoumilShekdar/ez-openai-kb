const SUPPORTED_FILE_TYPES: Record<string, string[]> = {
  c: ["text/x-c"],
  cpp: ["text/x-c++", "text/plain"],
  cs: ["text/x-csharp", "text/plain"],
  css: ["text/css"],
  csv: ["text/csv", "application/csv"],
  doc: ["application/msword"],
  docx: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  go: ["text/x-go", "text/plain"],
  h: ["text/x-c", "text/plain"],
  html: ["text/html"],
  java: ["text/x-java", "text/plain"],
  js: ["text/javascript", "application/javascript", "text/plain"],
  json: ["application/json", "text/json", "text/plain"],
  md: ["text/markdown", "text/x-markdown", "text/plain"],
  pdf: ["application/pdf"],
  php: ["application/x-httpd-php", "text/plain"],
  pptx: [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
  py: ["text/x-python", "text/plain"],
  rb: ["text/x-ruby", "text/plain"],
  sh: ["application/x-sh", "text/x-shellscript", "text/plain"],
  tex: ["text/x-tex", "text/plain"],
  ts: ["text/typescript", "application/typescript", "text/plain"],
  tsx: ["text/tsx", "text/plain"],
  txt: ["text/plain"],
  xls: ["application/vnd.ms-excel"],
  xlsx: [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
  xml: ["application/xml", "text/xml", "text/plain"],
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
      `Unsupported file type for "${filename}". Upload one of the OpenAI-supported document, text, spreadsheet, code, or PDF formats.`,
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
