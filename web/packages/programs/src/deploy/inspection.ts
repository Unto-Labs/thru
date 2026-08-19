import { Pubkey } from "@thru/sdk";
import { deriveProgramABIAddresses } from "../abi-manager";
import { bytesEqual } from "../helpers/bytes";
import { deriveManagedProgramAddresses } from "../manager";
import {
  assertManagedProgramAccount,
  assertPubkeyBytes,
  getOptionalAccount,
  parseABIAccount,
  parseABIMeta,
  parseManagerMeta,
  requireAccountData,
} from "./accounts";
import { DeployError, asDeployError } from "./errors";
import { seedBytes } from "./seeds";
import type {
  ABIAccountInspection,
  InspectProgramDeploymentRequest,
  ProgramAccountInspection,
  ProgramDeploymentInspection,
} from "./types";

function absentPair(
  metadataPresent: boolean,
  accountPresent: boolean,
): Extract<ProgramAccountInspection, { status: "missing" | "partial" }> {
  return metadataPresent || accountPresent
    ? { status: "partial", metadataPresent, accountPresent }
    : { status: "missing", metadataPresent: false, accountPresent: false };
}

export async function inspectProgramDeployment(
  request: InspectProgramDeploymentRequest,
): Promise<ProgramDeploymentInspection> {
  seedBytes(request.seed);
  const ephemeral = request.ephemeral ?? false;
  const programAddresses = deriveManagedProgramAddresses(
    request.seed,
    ephemeral,
  );
  const abiAddresses = deriveProgramABIAddresses(
    programAddresses.programAccountAddress,
    ephemeral,
  );
  const inspectABI =
    request.inspectABI || request.expectedABIBytes !== undefined;
  const [metadataAccount, programAccount, abiMetadataAccount, abiAccount] =
    await Promise.all([
      getOptionalAccount(
        request.client,
        programAddresses.programMetaAccountAddress,
      ),
      getOptionalAccount(
        request.client,
        programAddresses.programAccountAddress,
      ),
      inspectABI
        ? getOptionalAccount(request.client, abiAddresses.abiMetaAccountAddress)
        : undefined,
      inspectABI
        ? getOptionalAccount(request.client, abiAddresses.abiAccountAddress)
        : undefined,
    ]);

  let program: ProgramAccountInspection;
  if (!metadataAccount || !programAccount) {
    program = absentPair(!!metadataAccount, !!programAccount);
  } else {
    const metadata = parseManagerMeta(metadataAccount);
    assertManagedProgramAccount(programAccount);
    const authorityAddress = Pubkey.from(metadata.authority).toThruFmt();
    if (request.authorityAddress !== undefined) {
      let expectedAuthority: Uint8Array;
      try {
        expectedAuthority = Pubkey.from(request.authorityAddress).toBytes();
      } catch (error) {
        throw asDeployError(
          error,
          "INVALID_INPUT",
          "authorityAddress is not a valid Thru address",
        );
      }
      if (!bytesEqual(metadata.authority, expectedAuthority)) {
        throw new DeployError(
          "SIGNER_MISMATCH",
          `program authority mismatch: expected ${request.authorityAddress}, found ${authorityAddress}`,
        );
      }
    }
    program = {
      status: "present",
      metadataPresent: true,
      accountPresent: true,
      authorityAddress,
      version: metadata.version,
      state: metadata.state,
      bytesMatch:
        request.expectedProgramBytes === undefined
          ? undefined
          : bytesEqual(
              requireAccountData(programAccount, "managed program account"),
              request.expectedProgramBytes,
            ),
    };
  }

  let abi: ABIAccountInspection | undefined;
  if (inspectABI) {
    if (!abiMetadataAccount || !abiAccount) {
      abi = absentPair(!!abiMetadataAccount, !!abiAccount);
    } else {
      const metadata = parseABIMeta(abiMetadataAccount);
      const account = parseABIAccount(abiAccount);
      assertPubkeyBytes(
        metadata.program,
        programAddresses.programAccountAddress,
        "ABI metadata points to another program",
      );
      assertPubkeyBytes(
        account.abiMetaAccount,
        abiAddresses.abiMetaAccountAddress,
        "ABI account points to another metadata account",
      );
      abi = {
        status: "present",
        metadataPresent: true,
        accountPresent: true,
        revision: account.revision,
        state: account.state,
        bytesMatch:
          request.expectedABIBytes === undefined
            ? undefined
            : bytesEqual(account.content, request.expectedABIBytes),
      };
    }
  }

  return {
    programMetaAccountAddress: programAddresses.programMetaAccountAddress,
    programAccountAddress: programAddresses.programAccountAddress,
    abiMetaAccountAddress: abiAddresses.abiMetaAccountAddress,
    abiAccountAddress: abiAddresses.abiAccountAddress,
    program,
    abi,
  };
}
