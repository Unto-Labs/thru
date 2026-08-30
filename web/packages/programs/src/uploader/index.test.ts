import { describe, expect, it } from "vitest";
import {
  UPLOADER_DEFAULT_CHUNK_SIZE,
  UPLOADER_MAX_CHUNK_SIZE,
  UPLOADER_MIN_CHUNK_SIZE,
  UPLOADER_STATE_FINALIZED,
  buildUploaderInstructionBytes,
  deriveUploadAddresses,
  parseUploaderProgramMeta,
  uploaderErrorName,
} from "./index";

describe("uploader SDK", () => {
  it("exports the shared CLI-compatible chunk limits", () => {
    expect(UPLOADER_DEFAULT_CHUNK_SIZE).toBe(30_720);
    expect(UPLOADER_MIN_CHUNK_SIZE).toBe(1_024);
    expect(UPLOADER_MAX_CHUNK_SIZE).toBe(31_000);
  });

  it("matches the Rust derivation vector", () => {
    expect(deriveUploadAddresses("nft_program")).toMatchObject({
      metaAccountAddress: "taQEPklQRpE6rVlJ-XvUglKbjGIka1MTU9NDebMAWK4HBr",
      bufferAccountAddress: "tavDEeyUOTr1GZKoYzACMI9omCnevh01E7XkXZMIv9pxcM",
    });
  });

  it("encodes all uploader instructions exactly", () => {
    const hash = new Uint8Array(32).fill(5);
    expect(
      Array.from(
        buildUploaderInstructionBytes({
          kind: "create",
          bufferAccountIdx: 1,
          metaAccountIdx: 2,
          authorityAccountIdx: 3,
          bufferSize: 4,
          expectedHash: hash,
          seed: Uint8Array.of(6, 7),
        }),
      ),
    ).toEqual([
      0,
      0,
      0,
      0,
      1,
      0,
      2,
      0,
      3,
      0,
      4,
      0,
      0,
      0,
      ...hash,
      2,
      0,
      0,
      0,
      6,
      7,
    ]);
    expect(
      Array.from(
        buildUploaderInstructionBytes({
          kind: "write",
          bufferAccountIdx: 1,
          metaAccountIdx: 2,
          offset: 8,
          data: Uint8Array.of(9, 10),
        }),
      ),
    ).toEqual([1, 0, 0, 0, 1, 0, 2, 0, 2, 0, 0, 0, 8, 0, 0, 0, 9, 10]);
    expect(
      Array.from(
        buildUploaderInstructionBytes({
          kind: "destroy",
          bufferAccountIdx: 1,
          metaAccountIdx: 2,
        }),
      ),
    ).toEqual([2, 0, 0, 0, 1, 0, 2, 0]);
    expect(
      Array.from(
        buildUploaderInstructionBytes({
          kind: "finalize",
          bufferAccountIdx: 1,
          metaAccountIdx: 2,
          expectedHash: hash,
        }),
      ),
    ).toEqual([3, 0, 0, 0, 1, 0, 2, 0, ...hash]);
  });

  it("parses metadata and maps errors", () => {
    const data = new Uint8Array(65);
    data.fill(1, 0, 32);
    data.fill(2, 32, 64);
    data[64] = UPLOADER_STATE_FINALIZED;
    expect(parseUploaderProgramMeta(data)).toMatchObject({
      expectedHash: new Uint8Array(32).fill(2),
      state: UPLOADER_STATE_FINALIZED,
    });
    expect(uploaderErrorName(6n)).toBe("HASH_MISMATCH");
  });
});
