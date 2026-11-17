import { describe, expect, it } from "vitest";
import {
  UPLOADER_ACCOUNT_TYPE_META_V1,
  UPLOADER_META_SIZE,
  UPLOADER_STATE_FINALIZED,
  buildUploaderInstructionBytes,
  parseUploaderProgramMeta,
  uploaderErrorName,
} from "./index";

describe("uploader SDK", () => {

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
    const data = new Uint8Array(UPLOADER_META_SIZE);
    expect(data).toHaveLength(66);
    data[0] = UPLOADER_ACCOUNT_TYPE_META_V1;
    data.fill(1, 1, 33);
    data.fill(2, 33, 65);
    data[65] = UPLOADER_STATE_FINALIZED;
    expect(parseUploaderProgramMeta(data)).toMatchObject({
      expectedHash: new Uint8Array(32).fill(2),
      state: UPLOADER_STATE_FINALIZED,
    });
    expect(() => parseUploaderProgramMeta(data.subarray(0, 65))).toThrow(
      "not an uploader metadata account",
    );
    data[0] = 0;
    expect(() => parseUploaderProgramMeta(data)).toThrow(
      "not an uploader metadata account",
    );
    expect(uploaderErrorName(6n)).toBe("HASH_MISMATCH");
  });
});
