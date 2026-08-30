import { Account, Pubkey } from "@thru/sdk";
import type { Thru } from "@thru/sdk/client";
import { parseManagerProgramMeta } from "../manager";
import {
  parseABIAccount as parseABIManagerAccount,
  parseABIMetaAccount,
} from "../abi-manager";
import { parseUploaderProgramMeta } from "../uploader";
import { bytesEqual } from "../helpers/bytes";
import {
  ABI_MANAGER_PROGRAM_ADDRESS,
  ABI_STATE_FINALIZED,
  ABI_STATE_OPEN,
  MANAGER_PROGRAM_ADDRESS,
  MANAGER_STATE_FINALIZED,
  MANAGER_STATE_OPEN,
  UPLOADER_PROGRAM_ADDRESS,
} from "./constants";
import { DeployError, asDeployError } from "./errors";

export interface ParsedManagerMeta {
  authority: Uint8Array;
  version: bigint;
  state: number;
}

export interface ParsedABIMeta {
  program: Uint8Array;
}

export interface ParsedABIAccount {
  abiMetaAccount: Uint8Array;
  revision: bigint;
  state: number;
  content: Uint8Array;
}

export interface ParsedUploaderMeta {
  authority: Uint8Array;
  expectedHash: Uint8Array;
  state: number;
}

export async function getOptionalAccount(
  client: Thru,
  address: string,
): Promise<Account | undefined> {
  try {
    return await client.accounts.get(address);
  } catch (error) {
    if ((error as { code?: number } | undefined)?.code === 5) return undefined;
    throw asDeployError(
      error,
      "RPC_ERROR",
      `Failed to read account ${address}`,
    );
  }
}

export function requireAccountData(
  account: Account,
  label: string,
): Uint8Array {
  const data = account.data?.data;
  if (!data)
    throw new DeployError("VERIFICATION_FAILED", `${label} data is missing`);
  return data;
}

function assertOwner(account: Account, owner: string, label: string): void {
  if (!account.meta?.owner?.equals(owner)) {
    throw new DeployError(
      "VERIFICATION_FAILED",
      `${label} has an unexpected owner`,
    );
  }
}

export function assertManagedProgramAccount(
  account: Account,
  label = "managed program account",
): void {
  assertOwner(account, MANAGER_PROGRAM_ADDRESS, label);
  if (!account.meta?.flags.isProgram) {
    throw new DeployError("VERIFICATION_FAILED", `${label} is not executable`);
  }
}

export function parseManagerMeta(account: Account): ParsedManagerMeta {
  assertOwner(account, MANAGER_PROGRAM_ADDRESS, "program metadata account");
  try {
    const parsed = parseManagerProgramMeta(account);
    return {
      authority: Pubkey.from(parsed.authorityAddress).toBytes(),
      version: parsed.version,
      state: parsed.state,
    };
  } catch (error) {
    throw asDeployError(
      error,
      "VERIFICATION_FAILED",
      "program metadata account is invalid",
    );
  }
}

export function parseABIMeta(account: Account): ParsedABIMeta {
  assertOwner(account, ABI_MANAGER_PROGRAM_ADDRESS, "ABI metadata account");
  const data = requireAccountData(account, "ABI metadata account");
  let parsed;
  try {
    parsed = parseABIMetaAccount(data);
  } catch (error) {
    throw asDeployError(
      error,
      "VERIFICATION_FAILED",
      "official ABI metadata account is invalid",
    );
  }
  if (parsed.kind !== "official") {
    throw new DeployError(
      "VERIFICATION_FAILED",
      "ABI metadata account is not official",
    );
  }
  for (let index = 36; index < data.length; index += 1) {
    if (data[index] !== 0) {
      throw new DeployError(
        "VERIFICATION_FAILED",
        "official ABI metadata reserved bytes are invalid",
      );
    }
  }
  return { program: Pubkey.from(parsed.programAddress).toBytes() };
}

export function parseABIAccount(account: Account): ParsedABIAccount {
  assertOwner(account, ABI_MANAGER_PROGRAM_ADDRESS, "ABI account");
  try {
    const parsed = parseABIManagerAccount(account);
    return {
      abiMetaAccount: Pubkey.from(parsed.abiMetaAccountAddress).toBytes(),
      revision: parsed.revision,
      state: parsed.state,
      content: parsed.contents,
    };
  } catch (error) {
    throw asDeployError(error, "VERIFICATION_FAILED", "ABI account is invalid");
  }
}

export function parseUploaderMeta(account: Account): ParsedUploaderMeta {
  if (!account.meta?.owner?.equals(UPLOADER_PROGRAM_ADDRESS)) {
    throw new DeployError(
      "UPLOAD_CONFLICT",
      "uploader metadata account has an unexpected owner",
    );
  }
  try {
    const parsed = parseUploaderProgramMeta(account);
    return {
      authority: Pubkey.from(parsed.authorityAddress).toBytes(),
      expectedHash: parsed.expectedHash,
      state: parsed.state,
    };
  } catch (error) {
    throw asDeployError(
      error,
      "UPLOAD_CONFLICT",
      "uploader metadata account is invalid",
    );
  }
}

export function assertManagerOpen(meta: ParsedManagerMeta): void {
  if (meta.state === MANAGER_STATE_FINALIZED) {
    throw new DeployError("TARGET_FINALIZED", "managed program is finalized");
  }
  if (meta.state !== MANAGER_STATE_OPEN) {
    throw new DeployError(
      "VERIFICATION_FAILED",
      `managed program is not open (state ${meta.state})`,
    );
  }
}

export function assertABIOpen(abi: ParsedABIAccount): void {
  if (abi.state === ABI_STATE_FINALIZED) {
    throw new DeployError("TARGET_FINALIZED", "program ABI is finalized");
  }
  if (abi.state !== ABI_STATE_OPEN) {
    throw new DeployError(
      "VERIFICATION_FAILED",
      `program ABI is not open (state ${abi.state})`,
    );
  }
}

export function assertPubkeyBytes(
  actual: Uint8Array,
  expected: string | Uint8Array,
  message: string,
): void {
  const expectedBytes =
    expected instanceof Uint8Array ? expected : Pubkey.from(expected).toBytes();
  if (!bytesEqual(actual, expectedBytes))
    throw new DeployError("VERIFICATION_FAILED", message);
}
