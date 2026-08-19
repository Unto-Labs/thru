import {
  Pubkey,
  createThruClient,
  type Account,
  type InstructionContext,
} from "@thru/sdk";
import type { Thru } from "@thru/sdk/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MulticallArgs } from "../multicall";
import { deriveProgramABIAddresses } from "../abi-manager";
import { deriveManagedProgramAddresses } from "../manager";
import {
  ABI_MANAGER_PROGRAM_ADDRESS,
  MANAGER_PROGRAM_ADDRESS,
  MULTICALL_PROGRAM_ADDRESS,
} from "./constants";
import { DeployError } from "./errors";
import type { DeploymentTransaction } from "./chain";
import type { PreparedUpload } from "./uploader";
import { deployProgram, upgradeProgram } from "./workflows";

const mocks = vi.hoisted(() => ({
  submitTransaction: vi.fn(),
  uploadArtifact: vi.fn(),
  cleanupUpload: vi.fn(),
}));

function creationProof(): Uint8Array {
  const proof = new Uint8Array(104);
  new DataView(proof.buffer).setBigUint64(0, 2n << 62n, true);
  return proof;
}

vi.mock("@thru/sdk/abi", () => ({
  buildLayoutIrWithManifest: vi.fn(async () => ({ rootTypes: [] })),
  OnchainFetcher: class {},
  resolveImports: vi.fn(async (yaml: string) => ({
    root: { id: { packageName: "test.deploy.workflow" } },
    manifest: { "test.deploy.workflow": yaml },
  })),
}));

vi.mock("./chain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./chain")>();
  return {
    ...actual,
    creationProof: vi.fn(async () => creationProof()),
    submitTransaction: mocks.submitTransaction,
  };
});

vi.mock("./uploader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./uploader")>();
  return {
    ...actual,
    uploadArtifact: mocks.uploadArtifact,
    cleanupUpload: mocks.cleanupUpload,
  };
});

const ABI_BYTES = new TextEncoder().encode(`
abi:
  package: "test.deploy.workflow"
  abi-version: 1
  package-version: "1.0.0"
  description: "workflow test"
  imports: []
types:
  - name: "Value"
    kind:
      struct:
        packed: true
        fields:
          - name: "value"
            field-type:
              primitive: u64
`);

function image(fill: number): Uint8Array {
  const bytes = new Uint8Array(20).fill(fill);
  bytes[0] = 1;
  bytes.fill(0, bytes.length - 8);
  return bytes;
}

function missing(): never {
  throw Object.assign(new Error("not found"), { code: 5 });
}

function storedAccount(
  address: string,
  owner: string,
  data: Uint8Array,
  isProgram = false,
): Account {
  return {
    address: Pubkey.from(address),
    meta: {
      owner: Pubkey.from(owner),
      flags: { isProgram },
    },
    data: { data },
  } as Account;
}

interface Harness {
  client: Thru;
  signer: { address: string; privateKey: Uint8Array };
  program: ReturnType<typeof deriveManagedProgramAddresses>;
  abi: Awaited<ReturnType<typeof deriveProgramABIAddresses>>;
  state: {
    committed: boolean;
    submitMode: "success" | "failure" | "unknown";
    wrongProgramReadback: boolean;
    duplicateTarget: boolean;
    encoded?: Uint8Array;
    transaction?: DeploymentTransaction;
  };
}

function instructionContext(
  feePayer: string,
  transaction: DeploymentTransaction,
): InstructionContext {
  const normalize = (values: string[] = []) =>
    values.slice().sort((left, right) => {
      const a = Pubkey.from(left).toBytes();
      const b = Pubkey.from(right).toBytes();
      for (let index = 0; index < a.length; index += 1) {
        if (a[index] !== b[index]) return a[index] - b[index];
      }
      return 0;
    });
  const addresses = [
    feePayer,
    transaction.program,
    ...normalize(transaction.readWrite),
    ...normalize(transaction.readOnly),
  ];
  return {
    accounts: addresses.map((address) => Pubkey.from(address)),
    getAccountIndex: (value) => {
      const address = Pubkey.from(value).toThruFmt();
      const index = addresses.indexOf(address);
      if (index < 0) throw new Error(`account not found: ${address}`);
      return index;
    },
  };
}

async function makeHarness(upgrade = false): Promise<Harness> {
  const privateKey = new Uint8Array(32).fill(0x19);
  const localClient = createThruClient();
  const publicKey = await localClient.keys.fromPrivateKey(privateKey);
  const signer = { address: Pubkey.from(publicKey).toThruFmt(), privateKey };
  const program = deriveManagedProgramAddresses("workflow");
  const abi = deriveProgramABIAddresses(program.programAccountAddress);
  const state: Harness["state"] = {
    committed: false,
    submitMode: "success",
    wrongProgramReadback: false,
    duplicateTarget: false,
  };

  const oldProgram = image(0x22);
  const newProgram = image(0x33);
  const oldABI = ABI_BYTES.slice();
  oldABI[oldABI.length - 1] = 0x0a;

  function permanentAccounts(final: boolean): Map<string, Account> {
    const version = upgrade && final ? 6n : upgrade ? 5n : 0n;
    const revision = upgrade && final ? 3n : upgrade ? 2n : 0n;
    const managerData = new Uint8Array(73);
    managerData.set(publicKey);
    new DataView(managerData.buffer).setBigUint64(64, version, true);

    const abiMetaData = new Uint8Array(100);
    abiMetaData[0] = 1;
    abiMetaData.set(Pubkey.from(program.programAccountAddress).toBytes(), 4);

    const abiBytes = final ? ABI_BYTES : oldABI;
    const abiData = new Uint8Array(45 + abiBytes.length);
    abiData.set(Pubkey.from(abi.abiMetaAccountAddress).toBytes());
    new DataView(abiData.buffer).setBigUint64(32, revision, true);
    new DataView(abiData.buffer).setUint32(41, abiBytes.length, true);
    abiData.set(abiBytes, 45);

    const programBytes = final
      ? state.wrongProgramReadback
        ? image(0x77)
        : newProgram
      : oldProgram;
    return new Map([
      [
        program.programMetaAccountAddress,
        storedAccount(
          program.programMetaAccountAddress,
          MANAGER_PROGRAM_ADDRESS,
          managerData,
        ),
      ],
      [
        program.programAccountAddress,
        storedAccount(
          program.programAccountAddress,
          MANAGER_PROGRAM_ADDRESS,
          programBytes,
          true,
        ),
      ],
      [
        abi.abiMetaAccountAddress,
        storedAccount(
          abi.abiMetaAccountAddress,
          ABI_MANAGER_PROGRAM_ADDRESS,
          abiMetaData,
        ),
      ],
      [
        abi.abiAccountAddress,
        storedAccount(
          abi.abiAccountAddress,
          ABI_MANAGER_PROGRAM_ADDRESS,
          abiData,
        ),
      ],
    ]);
  }

  const client = {
    keys: { fromPrivateKey: vi.fn(async () => publicKey) },
    accounts: {
      get: vi.fn(async (address: string) => {
        if (upgrade)
          return permanentAccounts(state.committed).get(address) ?? missing();
        if (state.committed)
          return permanentAccounts(true).get(address) ?? missing();
        if (
          state.duplicateTarget &&
          address === program.programMetaAccountAddress
        ) {
          return permanentAccounts(false).get(address)!;
        }
        return missing();
      }),
    },
  } as unknown as Thru;

  mocks.submitTransaction.mockImplementation(
    async (
      _client: Thru,
      _signer: unknown,
      _operation: unknown,
      phase: string,
      transaction: DeploymentTransaction,
    ) => {
      expect(phase).toBe("commit");
      state.transaction = transaction;
      state.encoded =
        typeof transaction.instructionData === "function"
          ? await transaction.instructionData(
              instructionContext(signer.address, transaction),
            )
          : transaction.instructionData;
      if (state.submitMode === "failure") {
        throw new DeployError("TRANSACTION_FAILED", "ABI manager failed", {
          transactionSignature: "failed-signature",
          vmError: 4,
        });
      }
      state.committed = true;
      if (state.submitMode === "unknown") {
        throw new DeployError("OUTCOME_UNKNOWN", "tracking timeout", {
          transactionSignature: "unknown-signature",
        });
      }
      return "final-signature";
    },
  );

  return { client, signer, program, abi, state };
}

describe("deployment workflows", () => {
  beforeEach(() => {
    mocks.submitTransaction.mockReset();
    mocks.uploadArtifact.mockReset();
    mocks.cleanupUpload.mockReset();
    mocks.uploadArtifact.mockImplementation(
      async (_client: Thru, _signer: unknown, upload: PreparedUpload) =>
        upload.result,
    );
    mocks.cleanupUpload.mockImplementation(
      async (_client: Thru, _signer: unknown, upload: PreparedUpload) => {
        upload.result.cleanup = { status: "not-needed" };
        return upload.result.cleanup;
      },
    );
  });

  it("commits a program plus ABI in one ordered multicall and reports cleanup warnings", async () => {
    const harness = await makeHarness();
    mocks.cleanupUpload.mockImplementation(
      async (_client: Thru, _signer: unknown, upload: PreparedUpload) => {
        upload.result.cleanup =
          upload.artifact === "abi"
            ? { status: "failed", error: "cleanup unavailable" }
            : { status: "not-needed" };
        return upload.result.cleanup;
      },
    );

    const result = await deployProgram({
      seed: "workflow",
      signer: harness.signer,
      client: harness.client,
      program: image(0x33),
      abi: ABI_BYTES,
    });

    expect(mocks.submitTransaction).toHaveBeenCalledTimes(1);
    expect(harness.state.transaction?.program).toBe(MULTICALL_PROGRAM_ADDRESS);
    const calls = MulticallArgs.from_array(harness.state.encoded!)?.get_calls();
    expect(calls).toHaveLength(3);
    expect(calls?.map((call) => call.get_data()[0])).toEqual([0, 0, 4]);
    const context = instructionContext(
      harness.signer.address,
      harness.state.transaction!,
    );
    expect(calls?.map((call) => call.get_program_idx())).toEqual([
      context.getAccountIndex(MANAGER_PROGRAM_ADDRESS),
      context.getAccountIndex(ABI_MANAGER_PROGRAM_ADDRESS),
      context.getAccountIndex(ABI_MANAGER_PROGRAM_ADDRESS),
    ]);
    expect(result.transactionSignature).toBe("final-signature");
    expect(result.programVersion).toBe(0n);
    expect(result.abiRevision).toBe(0n);
    expect(result.warnings).toHaveLength(1);
    expect(result.abiUpload?.cleanup).toEqual({
      status: "failed",
      error: "cleanup unavailable",
    });
  });

  it("fails duplicate creates before any upload", async () => {
    const harness = await makeHarness();
    harness.state.duplicateTarget = true;
    await expect(
      deployProgram({
        seed: "workflow",
        signer: harness.signer,
        client: harness.client,
        program: image(0x33),
      }),
    ).rejects.toMatchObject({ code: "TARGET_EXISTS", phase: "preflight" });
    expect(mocks.uploadArtifact).not.toHaveBeenCalled();
    expect(mocks.submitTransaction).not.toHaveBeenCalled();
  });

  it("does not expose a program change when the combined ABI manager call fails", async () => {
    const harness = await makeHarness();
    harness.state.submitMode = "failure";
    await expect(
      deployProgram({
        seed: "workflow",
        signer: harness.signer,
        client: harness.client,
        program: image(0x33),
        abi: ABI_BYTES,
      }),
    ).rejects.toMatchObject({ code: "TRANSACTION_FAILED" });
    expect(harness.state.committed).toBe(false);
    await expect(
      harness.client.accounts.get(harness.program.programAccountAddress),
    ).rejects.toMatchObject({
      code: 5,
    });
  });

  it("rejects a successful transaction whose program readback does not match", async () => {
    const harness = await makeHarness();
    harness.state.wrongProgramReadback = true;
    await expect(
      deployProgram({
        seed: "workflow",
        signer: harness.signer,
        client: harness.client,
        program: image(0x33),
      }),
    ).rejects.toMatchObject({ code: "VERIFICATION_FAILED" });
  });

  it("reconciles an unknown final submission from verified account state", async () => {
    const harness = await makeHarness();
    harness.state.submitMode = "unknown";
    const result = await deployProgram({
      seed: "workflow",
      signer: harness.signer,
      client: harness.client,
      program: image(0x33),
    });
    expect(result.transactionSignature).toBe("unknown-signature");
    expect(result.programVersion).toBe(0n);
  });

  it("commits a program plus ABI upgrade in one ordered multicall", async () => {
    const harness = await makeHarness(true);
    const result = await upgradeProgram({
      seed: "workflow",
      signer: harness.signer,
      client: harness.client,
      program: image(0x33),
      abi: ABI_BYTES,
    });
    expect(mocks.submitTransaction).toHaveBeenCalledTimes(1);
    const calls = MulticallArgs.from_array(harness.state.encoded!)?.get_calls();
    expect(calls).toHaveLength(2);
    expect(calls?.map((call) => call.get_data()[0])).toEqual([2, 8]);
    expect(result.programVersion).toBe(6n);
    expect(result.abiRevision).toBe(3n);
  });
});
