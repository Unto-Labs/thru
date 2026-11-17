import { Account, Pubkey, createThruClient } from "@thru/sdk";
import { encodeAddress } from "@thru/sdk/helpers";
import { describe, expect, it, vi } from "vitest";
import { deriveProgramABIAddresses } from "../abi-manager";
import { deriveManagedProgramAddresses } from "../manager";
import {
  parseABIAccount,
  parseABIMeta,
  parseManagerMeta,
  parseUploaderMeta,
} from "./accounts";
import {
  ABI_MANAGER_PROGRAM_ADDRESS,
  MANAGER_PROGRAM_ADDRESS,
  DEPLOYMENT_MULTICALL_PROGRAM_ADDRESS,
  UPLOADER_PROGRAM_ADDRESS,
} from "./constants";
import { DeployError } from "./errors";
import { inspectProgramDeployment } from "./inspection";
import { seedBytes, temporarySeed } from "./seeds";
import {
  resolveSigner,
  validateABI,
  validateProgramImage,
  validateSeedAndChunkSize,
} from "./validation";

vi.mock("@thru/sdk/abi", () => ({
  buildLayoutIrWithManifest: vi.fn(async () => ({ rootTypes: [] })),
  OnchainFetcher: class {},
  resolveImports: vi.fn(async (yaml: string) => ({
    root: { id: { packageName: "test.deploy" } },
    manifest: { "test.deploy": yaml },
  })),
}));

function address(lastByte: number): string {
  const bytes = new Uint8Array(32);
  bytes[31] = lastByte;
  return encodeAddress(bytes);
}

function account(owner: string, data: Uint8Array): Account {
  return {
    meta: { owner: Pubkey.from(owner) },
    data: { data },
  } as Account;
}

describe("deployment address derivation", () => {

  it("uses the CLI suffix and SHA-256 fallback rules", async () => {
    await expect(temporarySeed("nft", "temporary")).resolves.toBe(
      "nft_temporary",
    );
    await expect(
      temporarySeed("12345678901234567890123456789012", "temporary"),
    ).resolves.toBe("57154b56ad5b3aa779bd86459729936c");
    expect(seedBytes("é".repeat(16))).toHaveLength(32);
    expect(() => seedBytes("é".repeat(17))).toThrow(DeployError);
  });

});

describe("deployment validation", () => {
  it("validates managed program image version, size, and trailer", () => {
    const valid = new Uint8Array(20);
    valid[0] = 1;
    expect(() => validateProgramImage(valid)).not.toThrow();
    expect(() => validateProgramImage(valid.slice(0, 19))).toThrow(
      /at least 20/,
    );
    const wrongVersion = valid.slice();
    wrongVersion[0] = 2;
    expect(() => validateProgramImage(wrongVersion)).toThrow(/version/);
    const elf = valid.slice();
    elf.set([0x7f, 0x45, 0x4c, 0x46]);
    expect(() => validateProgramImage(elf)).toThrow(/ELF file/);
    const wrongTrailer = valid.slice();
    wrongTrailer[wrongTrailer.length - 1] = 1;
    expect(() => validateProgramImage(wrongTrailer)).toThrow(/zero/);
  });

  it("validates chunk bounds and self-contained ABI YAML", async () => {
    expect(validateSeedAndChunkSize("nft")).toBe(30_720);
    expect(() => validateSeedAndChunkSize("nft", 1_023)).toThrow(/1024/);
    await expect(
      validateABI(
        new TextEncoder().encode(`
abi:
  package: "test.deploy"
  abi-version: 1
  package-version: "1.0.0"
  description: "deploy test"
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
`),
      ),
    ).resolves.toContain("test.deploy");
    await expect(
      validateABI(
        new TextEncoder().encode(`
abi:
  package: test.bad
  abi-version: 1
  package-version: "1.0.0"
  imports:
    - type: path
      path: local.abi.yaml
types: []
`),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("requires the private key to match the supplied address", async () => {
    const client = createThruClient();
    const privateKey = new Uint8Array(32).fill(7);
    const publicKey = await client.keys.fromPrivateKey(privateKey);
    const signerAddress = Pubkey.from(publicKey).toThruFmt();
    await expect(
      resolveSigner(client, signerAddress, privateKey),
    ).resolves.toMatchObject({
      address: signerAddress,
    });
    await expect(
      resolveSigner(client, address(31), privateKey),
    ).rejects.toMatchObject({
      code: "SIGNER_MISMATCH",
    });
  });
});

describe("deployment transaction composition", () => {
  it("resolves indices after the SDK sorts account lists", async () => {
    const client = createThruClient();
    const privateKey = new Uint8Array(32).fill(9);
    const publicKey = await client.keys.fromPrivateKey(privateKey);
    const low = address(7);
    const high = address(8);
    let observed: number[] = [];
    await client.transactions.buildAndSign({
      feePayer: { publicKey, privateKey },
      program: DEPLOYMENT_MULTICALL_PROGRAM_ADDRESS,
      header: { fee: 0n, nonce: 0n, startSlot: 1n, chainId: 1 },
      accounts: {
        readWrite: [high, low],
        readOnly: [MANAGER_PROGRAM_ADDRESS],
      },
      instructionData: async (context) => {
        observed = [
          context.getAccountIndex(low),
          context.getAccountIndex(high),
          context.getAccountIndex(MANAGER_PROGRAM_ADDRESS),
        ];
        return Uint8Array.of(0);
      },
    });
    expect(observed).toEqual([2, 3, 4]);
  });
});

describe("deployment account parsers", () => {
  it("parses manager, ABI, and uploader account formats", () => {
    const authority = new Uint8Array(32).fill(1);
    const managerData = new Uint8Array(74);
    managerData[0] = 1;
    managerData.set(authority, 1);
    new DataView(managerData.buffer).setBigUint64(65, 5n, true);
    managerData[73] = 0;
    expect(
      parseManagerMeta(account(MANAGER_PROGRAM_ADDRESS, managerData)),
    ).toEqual({
      authority,
      version: 5n,
      state: 0,
    });

    const program = new Uint8Array(32).fill(2);
    const abiMetaData = new Uint8Array(100);
    abiMetaData[0] = 1;
    abiMetaData.set(program, 4);
    expect(
      parseABIMeta(account(ABI_MANAGER_PROGRAM_ADDRESS, abiMetaData)),
    ).toEqual({ program });

    const abiAddress = new Uint8Array(32).fill(3);
    const content = Uint8Array.of(0x61, 0x62, 0x69);
    const abiData = new Uint8Array(46 + content.length);
    abiData[0] = 2;
    abiData.set(abiAddress, 1);
    new DataView(abiData.buffer).setBigUint64(33, 7n, true);
    abiData[41] = 0;
    new DataView(abiData.buffer).setUint32(42, content.length, true);
    abiData.set(content, 46);
    expect(
      parseABIAccount(account(ABI_MANAGER_PROGRAM_ADDRESS, abiData)),
    ).toEqual({
      abiMetaAccount: abiAddress,
      revision: 7n,
      state: 0,
      content,
    });

    const hash = new Uint8Array(32).fill(4);
    const uploadData = new Uint8Array(66);
    uploadData[0] = 1;
    uploadData.set(authority, 1);
    uploadData.set(hash, 33);
    uploadData[65] = 2;
    expect(
      parseUploaderMeta(account(UPLOADER_PROGRAM_ADDRESS, uploadData)),
    ).toEqual({
      authority,
      expectedHash: hash,
      state: 2,
    });
  });
});

describe("deployment inspection", () => {
  it("reports validated program and ABI state with byte matches", async () => {
    const authority = new Uint8Array(32).fill(7);
    const authorityAddress = Pubkey.from(authority).toThruFmt();
    const addresses = deriveManagedProgramAddresses("inspect");
    const abiAddresses = deriveProgramABIAddresses(
      addresses.programAccountAddress,
    );
    const programBytes = Uint8Array.of(1, 2, 3);
    const abiBytes = Uint8Array.of(4, 5);
    const managerData = new Uint8Array(74);
    managerData[0] = 1;
    managerData.set(authority, 1);
    new DataView(managerData.buffer).setBigUint64(65, 6n, true);

    const abiMetaData = new Uint8Array(100);
    abiMetaData[0] = 1;
    abiMetaData.set(addresses.programAccountBytes, 4);
    const abiData = new Uint8Array(46 + abiBytes.length);
    abiData[0] = 2;
    abiData.set(abiAddresses.abiMetaAccountBytes, 1);
    new DataView(abiData.buffer).setBigUint64(33, 3n, true);
    new DataView(abiData.buffer).setUint32(42, abiBytes.length, true);
    abiData.set(abiBytes, 46);

    const accounts = new Map<string, Account>([
      [
        addresses.programMetaAccountAddress,
        account(MANAGER_PROGRAM_ADDRESS, managerData),
      ],
      [
        addresses.programAccountAddress,
        {
          meta: {
            owner: Pubkey.from(MANAGER_PROGRAM_ADDRESS),
            flags: { isProgram: true },
          },
          data: { data: programBytes },
        } as Account,
      ],
      [
        abiAddresses.abiMetaAccountAddress,
        account(ABI_MANAGER_PROGRAM_ADDRESS, abiMetaData),
      ],
      [
        abiAddresses.abiAccountAddress,
        account(ABI_MANAGER_PROGRAM_ADDRESS, abiData),
      ],
    ]);
    const client = {
      accounts: {
        get: vi.fn(async (accountAddress: string) => {
          const stored = accounts.get(accountAddress);
          if (!stored) throw { code: 5 };
          return stored;
        }),
      },
    } as unknown as Parameters<typeof inspectProgramDeployment>[0]["client"];

    await expect(
      inspectProgramDeployment({
        client,
        seed: "inspect",
        authorityAddress,
        expectedProgramBytes: programBytes,
        inspectABI: true,
        expectedABIBytes: abiBytes,
      }),
    ).resolves.toMatchObject({
      program: { status: "present", version: 6n, bytesMatch: true },
      abi: { status: "present", revision: 3n, bytesMatch: true },
    });

    accounts.delete(addresses.programAccountAddress);
    await expect(
      inspectProgramDeployment({ client, seed: "inspect" }),
    ).resolves.toMatchObject({ program: { status: "partial" } });
  });
});
