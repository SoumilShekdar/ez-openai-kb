import { ApiError } from "@/lib/api";

type DriveDownload = {
  downloadUrl: string;
  filename: string;
};

function readDriveIdFromUrl(url: URL) {
  const pathMatch = url.pathname.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (pathMatch?.[1]) {
    return pathMatch[1];
  }

  const fromQuery = url.searchParams.get("id");
  if (fromQuery) {
    return fromQuery;
  }

  return null;
}

export function resolveGoogleDriveDownload(input: string): DriveDownload {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ApiError(400, "Enter a valid Google Drive or Google Docs link.");
  }

  const hostname = url.hostname.replace(/^www\./, "");
  if (!["drive.google.com", "docs.google.com"].includes(hostname)) {
    throw new ApiError(400, "The link must be a public Google Drive, Docs, Sheets, or Slides URL.");
  }

  const driveId = readDriveIdFromUrl(url);
  if (!driveId) {
    throw new ApiError(400, "Could not determine the Google file ID from that link.");
  }

  if (url.pathname.includes("/document/")) {
    return {
      downloadUrl: `https://docs.google.com/document/d/${driveId}/export?format=txt`,
      filename: `${driveId}.txt`,
    };
  }

  if (url.pathname.includes("/spreadsheets/")) {
    const gid = url.searchParams.get("gid") || "0";
    return {
      downloadUrl: `https://docs.google.com/spreadsheets/d/${driveId}/export?format=csv&gid=${gid}`,
      filename: `${driveId}.csv`,
    };
  }

  if (url.pathname.includes("/presentation/")) {
    return {
      downloadUrl: `https://docs.google.com/presentation/d/${driveId}/export/pdf`,
      filename: `${driveId}.pdf`,
    };
  }

  return {
    downloadUrl: `https://drive.google.com/uc?export=download&id=${driveId}`,
    filename: `${driveId}`,
  };
}
