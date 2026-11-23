export type DocumentKind = "pdf" | "image";
export type DocumentCheck =
  { ok: true; kind: DocumentKind } | { ok: false; error: string };

export const DOCUMENT_MAX_BYTES = 25_000_000;
export const DOCUMENT_ACCEPT =
  "application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg";
export const DOCUMENT_CAMERA_ACCEPT = "image/jpeg,image/png";

const MIME_KINDS: Record<string, DocumentKind> = {
  "application/pdf": "pdf",
  "application/x-pdf": "pdf",
  "image/png": "image",
  "image/jpeg": "image",
  "image/jpg": "image",
  "image/pjpeg": "image",
};
const EXT_KINDS: Record<string, DocumentKind> = {
  pdf: "pdf",
  png: "image",
  jpg: "image",
  jpeg: "image",
};

export function checkDocument(file: {
  name: string;
  type: string;
  size: number;
}): DocumentCheck {
  // Some pickers report a known file as a generic binary, so its extension decides.
  const type = file.type === "application/octet-stream" ? "" : file.type;
  const kinds = type ? MIME_KINDS : EXT_KINDS;
  const extension = file.name.includes(".")
    ? file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase()
    : "";
  const key = type || extension;
  if (!Object.prototype.hasOwnProperty.call(kinds, key))
    return { ok: false, error: "Use a PDF, PNG or JPG file" };
  if (file.size === 0) return { ok: false, error: "This file is empty" };
  if (file.size > DOCUMENT_MAX_BYTES)
    return { ok: false, error: "This file is over 25 MB" };
  return { ok: true, kind: kinds[key] };
}

export function formatDocumentSize(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1).replace(/\.0$/, "")} MB`;
}
