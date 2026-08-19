import {
  AbiManagerInstruction,
  AbiManagerInstructionBuilder,
  CloseAbiExternalArgsBuilder,
  CloseAbiOfficialArgsBuilder,
  CreateAbiExternalEphemeralArgsBuilder,
  CreateAbiExternalPermanentArgsBuilder,
  CreateAbiOfficialEphemeralArgsBuilder,
  CreateAbiOfficialPermanentArgsBuilder,
  CreateMetaExternalEphemeralArgsBuilder,
  CreateMetaExternalPermanentArgsBuilder,
  CreateMetaOfficialEphemeralArgsBuilder,
  CreateMetaOfficialPermanentArgsBuilder,
  FinalizeAbiExternalArgsBuilder,
  FinalizeAbiOfficialArgsBuilder,
  UpgradeAbiExternalArgsBuilder,
  UpgradeAbiOfficialArgsBuilder,
} from './abi/thru/program/abi_manager/types';
import {
  accountIndex,
  assertU16,
  assertU32,
  exactBytes,
  type AccountLookupContext,
  type InstructionData,
} from '../utils/helpers';
import type {
  ABIManagerInstructionArgs,
  AccountCreationMode,
  ExternalABIAccounts,
  ExternalABIControlAccounts,
  ExternalABIMetaAccounts,
  OfficialABIAccounts,
  OfficialABIControlAccounts,
  OfficialABIMetaAccounts,
} from './types';

type ABIVariant =
  (typeof AbiManagerInstruction.payloadVariantDescriptors)[number]['name'];

function envelope(variant: ABIVariant, payload: Uint8Array): Uint8Array {
  return new AbiManagerInstructionBuilder()
    .payload()
    .select(variant)
    .writePayload(payload)
    .finish()
    .build();
}

function validateIndex(value: number, label: string): number {
  assertU16(value, label);
  return value;
}

function sourceOffset(value: number | undefined): number {
  const offset = value ?? 0;
  assertU32(offset, 'sourceOffset');
  return offset;
}

function sourceSize(value: number): number {
  assertU32(value, 'sourceSize');
  return value;
}

export function buildABIManagerInstructionBytes(
  args: ABIManagerInstructionArgs
): Uint8Array {
  switch (args.kind) {
    case 'createMetaOfficialPermanent':
      return envelope(
        'create_meta_official_permanent',
        new CreateMetaOfficialPermanentArgsBuilder()
          .set_abi_meta_account_idx(
            validateIndex(args.abiMetaAccountIdx, 'abiMetaAccountIdx')
          )
          .set_program_meta_account_idx(
            validateIndex(args.programMetaAccountIdx, 'programMetaAccountIdx')
          )
          .set_authority_account_idx(
            validateIndex(args.authorityAccountIdx, 'authorityAccountIdx')
          )
          .set_state_proof(args.stateProof)
          .build()
      );
    case 'createMetaOfficialEphemeral':
      return envelope(
        'create_meta_official_ephemeral',
        new CreateMetaOfficialEphemeralArgsBuilder()
          .set_abi_meta_account_idx(
            validateIndex(args.abiMetaAccountIdx, 'abiMetaAccountIdx')
          )
          .set_program_meta_account_idx(
            validateIndex(args.programMetaAccountIdx, 'programMetaAccountIdx')
          )
          .set_authority_account_idx(
            validateIndex(args.authorityAccountIdx, 'authorityAccountIdx')
          )
          .build()
      );
    case 'createMetaExternalPermanent':
      return envelope(
        'create_meta_external_permanent',
        new CreateMetaExternalPermanentArgsBuilder()
          .set_abi_meta_account_idx(
            validateIndex(args.abiMetaAccountIdx, 'abiMetaAccountIdx')
          )
          .set_authority_account_idx(
            validateIndex(args.authorityAccountIdx, 'authorityAccountIdx')
          )
          .set_target_program(
            exactBytes(args.targetProgram, 32, 'targetProgram')
          )
          .set_seed(exactBytes(args.seed, 32, 'external ABI seed'))
          .set_state_proof(args.stateProof)
          .build()
      );
    case 'createMetaExternalEphemeral':
      return envelope(
        'create_meta_external_ephemeral',
        new CreateMetaExternalEphemeralArgsBuilder()
          .set_abi_meta_account_idx(
            validateIndex(args.abiMetaAccountIdx, 'abiMetaAccountIdx')
          )
          .set_authority_account_idx(
            validateIndex(args.authorityAccountIdx, 'authorityAccountIdx')
          )
          .set_target_program(
            exactBytes(args.targetProgram, 32, 'targetProgram')
          )
          .set_seed(exactBytes(args.seed, 32, 'external ABI seed'))
          .build()
      );
    case 'createABIOfficialPermanent':
      return envelope(
        'create_abi_official_permanent',
        new CreateAbiOfficialPermanentArgsBuilder()
          .set_abi_meta_account_idx(
            validateIndex(args.abiMetaAccountIdx, 'abiMetaAccountIdx')
          )
          .set_program_meta_account_idx(
            validateIndex(args.programMetaAccountIdx, 'programMetaAccountIdx')
          )
          .set_abi_account_idx(
            validateIndex(args.abiAccountIdx, 'abiAccountIdx')
          )
          .set_srcbuf_account_idx(
            validateIndex(args.sourceBufferAccountIdx, 'sourceBufferAccountIdx')
          )
          .set_srcbuf_offset(sourceOffset(args.sourceOffset))
          .set_srcbuf_size(sourceSize(args.sourceSize))
          .set_authority_account_idx(
            validateIndex(args.authorityAccountIdx, 'authorityAccountIdx')
          )
          .set_state_proof(args.stateProof)
          .build()
      );
    case 'createABIOfficialEphemeral':
      return envelope(
        'create_abi_official_ephemeral',
        new CreateAbiOfficialEphemeralArgsBuilder()
          .set_abi_meta_account_idx(
            validateIndex(args.abiMetaAccountIdx, 'abiMetaAccountIdx')
          )
          .set_program_meta_account_idx(
            validateIndex(args.programMetaAccountIdx, 'programMetaAccountIdx')
          )
          .set_abi_account_idx(
            validateIndex(args.abiAccountIdx, 'abiAccountIdx')
          )
          .set_srcbuf_account_idx(
            validateIndex(args.sourceBufferAccountIdx, 'sourceBufferAccountIdx')
          )
          .set_srcbuf_offset(sourceOffset(args.sourceOffset))
          .set_srcbuf_size(sourceSize(args.sourceSize))
          .set_authority_account_idx(
            validateIndex(args.authorityAccountIdx, 'authorityAccountIdx')
          )
          .build()
      );
    case 'createABIExternalPermanent':
      return envelope(
        'create_abi_external_permanent',
        new CreateAbiExternalPermanentArgsBuilder()
          .set_abi_meta_account_idx(
            validateIndex(args.abiMetaAccountIdx, 'abiMetaAccountIdx')
          )
          .set_abi_account_idx(
            validateIndex(args.abiAccountIdx, 'abiAccountIdx')
          )
          .set_srcbuf_account_idx(
            validateIndex(args.sourceBufferAccountIdx, 'sourceBufferAccountIdx')
          )
          .set_srcbuf_offset(sourceOffset(args.sourceOffset))
          .set_srcbuf_size(sourceSize(args.sourceSize))
          .set_authority_account_idx(
            validateIndex(args.authorityAccountIdx, 'authorityAccountIdx')
          )
          .set_state_proof(args.stateProof)
          .build()
      );
    case 'createABIExternalEphemeral':
      return envelope(
        'create_abi_external_ephemeral',
        new CreateAbiExternalEphemeralArgsBuilder()
          .set_abi_meta_account_idx(
            validateIndex(args.abiMetaAccountIdx, 'abiMetaAccountIdx')
          )
          .set_abi_account_idx(
            validateIndex(args.abiAccountIdx, 'abiAccountIdx')
          )
          .set_srcbuf_account_idx(
            validateIndex(args.sourceBufferAccountIdx, 'sourceBufferAccountIdx')
          )
          .set_srcbuf_offset(sourceOffset(args.sourceOffset))
          .set_srcbuf_size(sourceSize(args.sourceSize))
          .set_authority_account_idx(
            validateIndex(args.authorityAccountIdx, 'authorityAccountIdx')
          )
          .build()
      );
    case 'upgradeABIOfficial':
      return envelope(
        'upgrade_abi_official',
        new UpgradeAbiOfficialArgsBuilder()
          .set_abi_meta_account_idx(
            validateIndex(args.abiMetaAccountIdx, 'abiMetaAccountIdx')
          )
          .set_program_meta_account_idx(
            validateIndex(args.programMetaAccountIdx, 'programMetaAccountIdx')
          )
          .set_abi_account_idx(
            validateIndex(args.abiAccountIdx, 'abiAccountIdx')
          )
          .set_srcbuf_account_idx(
            validateIndex(args.sourceBufferAccountIdx, 'sourceBufferAccountIdx')
          )
          .set_srcbuf_offset(sourceOffset(args.sourceOffset))
          .set_srcbuf_size(sourceSize(args.sourceSize))
          .set_authority_account_idx(
            validateIndex(args.authorityAccountIdx, 'authorityAccountIdx')
          )
          .build()
      );
    case 'upgradeABIExternal':
      return envelope(
        'upgrade_abi_external',
        new UpgradeAbiExternalArgsBuilder()
          .set_abi_meta_account_idx(
            validateIndex(args.abiMetaAccountIdx, 'abiMetaAccountIdx')
          )
          .set_abi_account_idx(
            validateIndex(args.abiAccountIdx, 'abiAccountIdx')
          )
          .set_srcbuf_account_idx(
            validateIndex(args.sourceBufferAccountIdx, 'sourceBufferAccountIdx')
          )
          .set_srcbuf_offset(sourceOffset(args.sourceOffset))
          .set_srcbuf_size(sourceSize(args.sourceSize))
          .set_authority_account_idx(
            validateIndex(args.authorityAccountIdx, 'authorityAccountIdx')
          )
          .build()
      );
    case 'closeABIOfficial':
    case 'finalizeABIOfficial': {
      const builder =
        args.kind === 'closeABIOfficial'
          ? new CloseAbiOfficialArgsBuilder()
          : new FinalizeAbiOfficialArgsBuilder();
      const payload = builder
        .set_abi_meta_account_idx(
          validateIndex(args.abiMetaAccountIdx, 'abiMetaAccountIdx')
        )
        .set_program_meta_account_idx(
          validateIndex(args.programMetaAccountIdx, 'programMetaAccountIdx')
        )
        .set_abi_account_idx(
          validateIndex(args.abiAccountIdx, 'abiAccountIdx')
        )
        .set_authority_account_idx(
          validateIndex(args.authorityAccountIdx, 'authorityAccountIdx')
        )
        .build();
      return envelope(
        args.kind === 'closeABIOfficial'
          ? 'close_abi_official'
          : 'finalize_abi_official',
        payload
      );
    }
    case 'closeABIExternal':
    case 'finalizeABIExternal': {
      const builder =
        args.kind === 'closeABIExternal'
          ? new CloseAbiExternalArgsBuilder()
          : new FinalizeAbiExternalArgsBuilder();
      const payload = builder
        .set_abi_meta_account_idx(
          validateIndex(args.abiMetaAccountIdx, 'abiMetaAccountIdx')
        )
        .set_abi_account_idx(
          validateIndex(args.abiAccountIdx, 'abiAccountIdx')
        )
        .set_authority_account_idx(
          validateIndex(args.authorityAccountIdx, 'authorityAccountIdx')
        )
        .build();
      return envelope(
        args.kind === 'closeABIExternal'
          ? 'close_abi_external'
          : 'finalize_abi_external',
        payload
      );
    }
  }
}

function officialMetaIndices(
  context: AccountLookupContext,
  args: OfficialABIMetaAccounts
): {
  abiMetaAccountIdx: number;
  programMetaAccountIdx: number;
  authorityAccountIdx: number;
} {
  return {
    abiMetaAccountIdx: accountIndex(
      context,
      args.abiMetaAccount,
      'abiMetaAccount'
    ),
    programMetaAccountIdx: accountIndex(
      context,
      args.programMetaAccount,
      'programMetaAccount'
    ),
    authorityAccountIdx: accountIndex(
      context,
      args.authorityAccount,
      'authorityAccount'
    ),
  };
}

function externalMetaIndices(
  context: AccountLookupContext,
  args: ExternalABIMetaAccounts
): {
  abiMetaAccountIdx: number;
  authorityAccountIdx: number;
  targetProgram: Uint8Array;
  seed: Uint8Array;
} {
  return {
    abiMetaAccountIdx: accountIndex(
      context,
      args.abiMetaAccount,
      'abiMetaAccount'
    ),
    authorityAccountIdx: accountIndex(
      context,
      args.authorityAccount,
      'authorityAccount'
    ),
    targetProgram: args.targetProgram,
    seed: args.seed,
  };
}

function officialABIIndices(
  context: AccountLookupContext,
  args: OfficialABIAccounts
) {
  return {
    ...officialMetaIndices(context, args),
    abiAccountIdx: accountIndex(context, args.abiAccount, 'abiAccount'),
    sourceBufferAccountIdx: accountIndex(
      context,
      args.sourceBufferAccount,
      'sourceBufferAccount'
    ),
    sourceOffset: args.sourceOffset,
    sourceSize: args.sourceSize,
  };
}

function externalABIIndices(
  context: AccountLookupContext,
  args: ExternalABIAccounts
) {
  return {
    abiMetaAccountIdx: accountIndex(
      context,
      args.abiMetaAccount,
      'abiMetaAccount'
    ),
    abiAccountIdx: accountIndex(context, args.abiAccount, 'abiAccount'),
    sourceBufferAccountIdx: accountIndex(
      context,
      args.sourceBufferAccount,
      'sourceBufferAccount'
    ),
    sourceOffset: args.sourceOffset,
    sourceSize: args.sourceSize,
    authorityAccountIdx: accountIndex(
      context,
      args.authorityAccount,
      'authorityAccount'
    ),
  };
}

export function createOfficialABIMetaInstruction(
  args: OfficialABIMetaAccounts & AccountCreationMode
): InstructionData {
  return async (context) => {
    const indices = officialMetaIndices(context, args);
    return args.ephemeral === true
      ? buildABIManagerInstructionBytes({
          kind: 'createMetaOfficialEphemeral',
          ...indices,
        })
      : buildABIManagerInstructionBytes({
          kind: 'createMetaOfficialPermanent',
          ...indices,
          stateProof: args.stateProof,
        });
  };
}

export function createExternalABIMetaInstruction(
  args: ExternalABIMetaAccounts & AccountCreationMode
): InstructionData {
  return async (context) => {
    const indices = externalMetaIndices(context, args);
    return args.ephemeral === true
      ? buildABIManagerInstructionBytes({
          kind: 'createMetaExternalEphemeral',
          ...indices,
        })
      : buildABIManagerInstructionBytes({
          kind: 'createMetaExternalPermanent',
          ...indices,
          stateProof: args.stateProof,
        });
  };
}

export function createOfficialABIInstruction(
  args: OfficialABIAccounts & AccountCreationMode
): InstructionData {
  return async (context) => {
    const indices = officialABIIndices(context, args);
    return args.ephemeral === true
      ? buildABIManagerInstructionBytes({
          kind: 'createABIOfficialEphemeral',
          ...indices,
        })
      : buildABIManagerInstructionBytes({
          kind: 'createABIOfficialPermanent',
          ...indices,
          stateProof: args.stateProof,
        });
  };
}

export function createExternalABIInstruction(
  args: ExternalABIAccounts & AccountCreationMode
): InstructionData {
  return async (context) => {
    const indices = externalABIIndices(context, args);
    return args.ephemeral === true
      ? buildABIManagerInstructionBytes({
          kind: 'createABIExternalEphemeral',
          ...indices,
        })
      : buildABIManagerInstructionBytes({
          kind: 'createABIExternalPermanent',
          ...indices,
          stateProof: args.stateProof,
        });
  };
}

export function createUpgradeOfficialABIInstruction(
  args: OfficialABIAccounts
): InstructionData {
  return async (context) =>
    buildABIManagerInstructionBytes({
      kind: 'upgradeABIOfficial',
      ...officialABIIndices(context, args),
    });
}

export function createUpgradeExternalABIInstruction(
  args: ExternalABIAccounts
): InstructionData {
  return async (context) =>
    buildABIManagerInstructionBytes({
      kind: 'upgradeABIExternal',
      ...externalABIIndices(context, args),
    });
}

function officialControlIndices(
  context: AccountLookupContext,
  args: OfficialABIControlAccounts
) {
  return {
    ...officialMetaIndices(context, args),
    abiAccountIdx: accountIndex(context, args.abiAccount, 'abiAccount'),
  };
}

function externalControlIndices(
  context: AccountLookupContext,
  args: ExternalABIControlAccounts
) {
  return {
    abiMetaAccountIdx: accountIndex(
      context,
      args.abiMetaAccount,
      'abiMetaAccount'
    ),
    abiAccountIdx: accountIndex(context, args.abiAccount, 'abiAccount'),
    authorityAccountIdx: accountIndex(
      context,
      args.authorityAccount,
      'authorityAccount'
    ),
  };
}

export function createCloseOfficialABIInstruction(
  args: OfficialABIControlAccounts
): InstructionData {
  return async (context) =>
    buildABIManagerInstructionBytes({
      kind: 'closeABIOfficial',
      ...officialControlIndices(context, args),
    });
}

export function createCloseExternalABIInstruction(
  args: ExternalABIControlAccounts
): InstructionData {
  return async (context) =>
    buildABIManagerInstructionBytes({
      kind: 'closeABIExternal',
      ...externalControlIndices(context, args),
    });
}

export function createFinalizeOfficialABIInstruction(
  args: OfficialABIControlAccounts
): InstructionData {
  return async (context) =>
    buildABIManagerInstructionBytes({
      kind: 'finalizeABIOfficial',
      ...officialControlIndices(context, args),
    });
}

export function createFinalizeExternalABIInstruction(
  args: ExternalABIControlAccounts
): InstructionData {
  return async (context) =>
    buildABIManagerInstructionBytes({
      kind: 'finalizeABIExternal',
      ...externalControlIndices(context, args),
    });
}
