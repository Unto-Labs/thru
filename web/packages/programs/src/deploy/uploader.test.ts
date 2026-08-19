import { Pubkey, type Account, type InstructionContext } from "@thru/sdk";
import type { Thru } from "@thru/sdk/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readU32le } from "../helpers/bytes";
import {
  UPLOADER_PROGRAM_ADDRESS,
  UPLOADER_STATE_FINALIZED,
  UPLOADER_STATE_OPEN,
} from "./constants";
import { DeployError } from "./errors";
import {
  cleanupUpload,
  prepareUpload,
  uploadArtifact,
  type PreparedUpload,
} from "./uploader";
import type { ResolvedSigner } from "./validation";

const mocks = vi.hoisted(() => ({ submitTransaction: vi.fn() }));

vi.mock("./chain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./chain")>();
  return { ...actual, submitTransaction: mocks.submitTransaction };
});

function missing(): never {
  throw Object.assign(new Error("not found"), { code: 5 });
}

function storedAccount(address: string, data: Uint8Array): Account {
  return {
    address: Pubkey.from(address),
    meta: {
      owner: Pubkey.from(UPLOADER_PROGRAM_ADDRESS),
      flags: { isProgram: false },
    },
    data: { data },
  } as Account;
}

function uploaderMeta(
  upload: PreparedUpload,
  signer: ResolvedSigner,
  state: number,
): Uint8Array {
  const data = new Uint8Array(65);
  data.set(signer.publicKey);
  data.set(upload.hash, 32);
  data[64] = state;
  return data;
}

function contextFor(
  transaction: {
    program: string;
    readWrite?: string[];
    readOnly?: string[];
  },
  feePayer: string,
): InstructionContext {
  const addresses = [
    feePayer,
    transaction.program,
    ...(transaction.readWrite ?? []),
    ...(transaction.readOnly ?? []),
  ];
  return {
    accounts: [],
    getAccountIndex: (value) => {
      const normalized =
        typeof value === "string" ? value : Pubkey.from(value).toThruFmt();
      const index = addresses.indexOf(normalized);
      if (index < 0) throw new Error(`missing account ${normalized}`);
      return index;
    },
  };
}

describe("resumable uploader", () => {
  const privateKey = new Uint8Array(32).fill(1);
  const signer: ResolvedSigner = {
    address: Pubkey.from(new Uint8Array(32).fill(2)).toThruFmt(),
    publicKey: new Uint8Array(32).fill(2),
    privateKey,
  };
  let accounts: Map<string, Account>;
  let client: Thru;
  let signatureNumber: number;
  let failCreateAfterApply: boolean;
  let failFirstWriteAfterApply: boolean;
  let failFinalizeAfterApply: boolean;

  beforeEach(() => {
    accounts = new Map();
    signatureNumber = 0;
    failCreateAfterApply = false;
    failFirstWriteAfterApply = false;
    failFinalizeAfterApply = false;
    client = {
      accounts: {
        get: vi.fn(
          async (address: string) => accounts.get(address) ?? missing(),
        ),
      },
    } as unknown as Thru;
    mocks.submitTransaction.mockReset();
    mocks.submitTransaction.mockImplementation(
      async (
        _client: Thru,
        _signer: ResolvedSigner,
        _operation: string,
        _phase: string,
        transaction: {
          program: string;
          readWrite?: string[];
          readOnly?: string[];
          instructionData:
            | Uint8Array
            | ((
                context: InstructionContext,
              ) => Uint8Array | Promise<Uint8Array>);
        },
      ) => {
        const data =
          typeof transaction.instructionData === "function"
            ? await transaction.instructionData(
                contextFor(transaction, signer.address),
              )
            : transaction.instructionData;
        const opcode = readU32le(data, 0);
        const [metaAddress, bufferAddress] = transaction.readWrite ?? [];
        const upload = currentUpload;
        const signature = `sig-${++signatureNumber}`;
        if (opcode === 0) {
          accounts.set(
            metaAddress,
            storedAccount(
              metaAddress,
              uploaderMeta(upload, signer, UPLOADER_STATE_OPEN),
            ),
          );
          accounts.set(
            bufferAddress,
            storedAccount(bufferAddress, new Uint8Array(upload.bytes.length)),
          );
          if (failCreateAfterApply) {
            failCreateAfterApply = false;
            throw new DeployError("OUTCOME_UNKNOWN", "lost response", {
              transactionSignature: signature,
            });
          }
        } else if (opcode === 1) {
          const size = readU32le(data, 8);
          const offset = readU32le(data, 12);
          accounts
            .get(bufferAddress)!
            .data!.data!.set(data.slice(16, 16 + size), offset);
          if (failFirstWriteAfterApply) {
            failFirstWriteAfterApply = false;
            throw new DeployError("OUTCOME_UNKNOWN", "lost response", {
              transactionSignature: signature,
            });
          }
        } else if (opcode === 3) {
          accounts.get(metaAddress)!.data!.data![64] = UPLOADER_STATE_FINALIZED;
          if (failFinalizeAfterApply) {
            failFinalizeAfterApply = false;
            throw new DeployError("OUTCOME_UNKNOWN", "lost response", {
              transactionSignature: signature,
            });
          }
        } else if (opcode === 2) {
          accounts.delete(metaAddress);
          accounts.delete(bufferAddress);
        }
        return signature;
      },
    );
  });

  let currentUpload: PreparedUpload;

  async function makeUpload(
    bytes = new Uint8Array(2_048).fill(0x5a),
  ): Promise<PreparedUpload> {
    currentUpload = await prepareUpload(
      "deployProgram",
      "program",
      "upload-test",
      bytes,
    );
    return currentUpload;
  }

  it("creates, uploads, finalizes, reports progress, and cleans a fresh upload", async () => {
    const upload = await makeUpload();
    const events: string[] = [];
    const result = await uploadArtifact(
      client,
      signer,
      upload,
      1_024,
      (event) => {
        events.push(`${event.uploadStep ?? event.phase}:${event.status}`);
      },
    );
    expect(result.reused).toBe(false);
    expect(result.transactionSignatures).toEqual([
      "sig-1",
      "sig-2",
      "sig-3",
      "sig-4",
    ]);
    expect(accounts.get(result.bufferAccountAddress)?.data?.data).toEqual(
      upload.bytes,
    );
    expect(accounts.get(result.metaAccountAddress)?.data?.data?.[64]).toBe(
      UPLOADER_STATE_FINALIZED,
    );
    expect(events).toContain("write:progress");
    expect(events.at(-1)).toBe("finalize:succeeded");

    await expect(cleanupUpload(client, signer, upload)).resolves.toEqual({
      status: "succeeded",
      transactionSignature: "sig-5",
    });
    expect(accounts.size).toBe(0);
  });

  it("resumes matching chunks and writes only missing data", async () => {
    const bytes = new Uint8Array(2_048).fill(0x33);
    const upload = await makeUpload(bytes);
    const buffer = new Uint8Array(bytes.length);
    buffer.set(bytes.slice(0, 1_024));
    accounts.set(
      upload.result.metaAccountAddress,
      storedAccount(
        upload.result.metaAccountAddress,
        uploaderMeta(upload, signer, UPLOADER_STATE_OPEN),
      ),
    );
    accounts.set(
      upload.result.bufferAccountAddress,
      storedAccount(upload.result.bufferAccountAddress, buffer),
    );

    const result = await uploadArtifact(client, signer, upload, 1_024);
    expect(result.reused).toBe(true);
    expect(result.transactionSignatures).toEqual(["sig-1", "sig-2"]);
    expect(accounts.get(result.bufferAccountAddress)?.data?.data).toEqual(
      bytes,
    );
  });

  it("reconciles an unknown write outcome and retains its signature", async () => {
    const upload = await makeUpload(new Uint8Array(1_024).fill(0x44));
    failFirstWriteAfterApply = true;
    const result = await uploadArtifact(client, signer, upload, 1_024);
    expect(result.transactionSignatures).toEqual(["sig-1", "sig-2", "sig-3"]);
    expect(accounts.get(result.bufferAccountAddress)?.data?.data).toEqual(
      upload.bytes,
    );
  });

  it("reconciles an unknown create outcome and retains its signature", async () => {
    const upload = await makeUpload(new Uint8Array(1_024).fill(0x45));
    failCreateAfterApply = true;
    const result = await uploadArtifact(client, signer, upload, 1_024);
    expect(result.transactionSignatures).toEqual(["sig-1", "sig-2", "sig-3"]);
    expect(accounts.get(result.metaAccountAddress)?.data?.data?.[64]).toBe(
      UPLOADER_STATE_FINALIZED,
    );
  });

  it("reconciles an unknown finalize outcome and retains its signature", async () => {
    const upload = await makeUpload(new Uint8Array(1_024).fill(0x46));
    failFinalizeAfterApply = true;
    const result = await uploadArtifact(client, signer, upload, 1_024);
    expect(result.transactionSignatures).toEqual(["sig-1", "sig-2", "sig-3"]);
    expect(accounts.get(result.metaAccountAddress)?.data?.data?.[64]).toBe(
      UPLOADER_STATE_FINALIZED,
    );
  });

  it("reuses a matching finalized upload without submitting transactions", async () => {
    const upload = await makeUpload();
    accounts.set(
      upload.result.metaAccountAddress,
      storedAccount(
        upload.result.metaAccountAddress,
        uploaderMeta(upload, signer, UPLOADER_STATE_FINALIZED),
      ),
    );
    accounts.set(
      upload.result.bufferAccountAddress,
      storedAccount(upload.result.bufferAccountAddress, upload.bytes.slice()),
    );
    const result = await uploadArtifact(client, signer, upload, 1_024);
    expect(result.reused).toBe(true);
    expect(result.transactionSignatures).toEqual([]);
    expect(mocks.submitTransaction).not.toHaveBeenCalled();
  });

  it("rejects an existing upload with a conflicting hash", async () => {
    const upload = await makeUpload();
    const meta = uploaderMeta(upload, signer, UPLOADER_STATE_OPEN);
    meta[32] ^= 0xff;
    accounts.set(
      upload.result.metaAccountAddress,
      storedAccount(upload.result.metaAccountAddress, meta),
    );
    accounts.set(
      upload.result.bufferAccountAddress,
      storedAccount(
        upload.result.bufferAccountAddress,
        new Uint8Array(upload.bytes.length),
      ),
    );
    await expect(
      uploadArtifact(client, signer, upload, 1_024),
    ).rejects.toMatchObject({
      code: "UPLOAD_CONFLICT",
    });
    expect(mocks.submitTransaction).not.toHaveBeenCalled();
  });
});
