import { expect, it } from "vitest";
import { checkDocument, formatDocumentSize } from "./document";

it.each([
  ["application/pdf", "x", "pdf"],
  ["image/png", "x", "image"],
  ["image/jpeg", "x", "image"],
  ["image/jpg", "x", "image"],
  ["image/pjpeg", "x", "image"],
  ["application/x-pdf", "x", "pdf"],
  ["", "ID.JPG", "image"],
  ["", "scan.jpeg", "image"],
  ["", "a.pdf", "pdf"],
  ["application/octet-stream", "a.pdf", "pdf"],
  ["application/octet-stream", "ID.JPG", "image"],
])("accepts %s with name %s", (type, name, kind) => {
  expect(checkDocument({ name, type, size: 1 })).toEqual({ ok: true, kind });
});

it.each([
  ["image/heic", "x.heic"],
  ["image/gif", "x.gif"],
  ["text/plain", "x.txt"],
  ["", "x.gif"],
  ["", "png"],
  ["image/gif", "x.png"],
  ["", "x.constructor"],
  ["constructor", "x.png"],
  ["application/octet-stream", "x.gif"],
  ["application/octet-stream", "x"],
])("rejects %s with name %s", (type, name) => {
  expect(checkDocument({ name, type, size: 1 })).toEqual({
    ok: false,
    error: "Use a PDF, PNG or JPG file",
  });
});

it("accepts the 25 MB boundary and rejects oversized and empty files", () => {
  const file = { name: "x.pdf", type: "application/pdf", size: 25_000_000 };
  expect(checkDocument(file)).toEqual({ ok: true, kind: "pdf" });
  expect(checkDocument({ ...file, size: 25_000_001 })).toEqual({
    ok: false,
    error: "This file is over 25 MB",
  });
  expect(checkDocument({ ...file, size: 0 })).toEqual({
    ok: false,
    error: "This file is empty",
  });
  expect(checkDocument({ ...file, type: "image/gif", size: 0 })).toEqual({
    ok: false,
    error: "Use a PDF, PNG or JPG file",
  });
});

it.each([
  [900, "900 B"],
  [12_300, "12 KB"],
  [2_400_000, "2.4 MB"],
  [25_000_000, "25 MB"],
])("formats %i bytes as %s", (bytes, expected) => {
  expect(formatDocumentSize(bytes)).toBe(expected);
});
