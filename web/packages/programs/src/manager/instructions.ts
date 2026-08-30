import {
  CreateEphemeralArgsBuilder,
  HeaderOnlyArgsBuilder,
  ManagerInstructionBuilder,
  SetAuthorityArgsBuilder,
  SetPauseArgsBuilder,
  UpgradeArgsBuilder,
} from './abi/thru/program/manager/types';
import { StateProof } from './abi/thru/blockchain/state_proof/types';
import {
  accountIndex,
  assertU16,
  assertU32,
  concatBytes,
  exactBytes,
  normalizeSeed,
  type InstructionData,
} from '../utils/helpers';
import type {
  ClaimAuthorityInstructionArgs,
  CreateEphemeralProgramInstructionArgs,
  CreatePermanentProgramInstructionArgs,
  DestroyProgramInstructionArgs,
  FinalizeProgramInstructionArgs,
  ManagerInstructionArgs,
  SetAuthorityInstructionArgs,
  SetPauseInstructionArgs,
  UpgradeProgramInstructionArgs,
} from './types';

type ManagerVariant =
  (typeof import('./abi/thru/program/manager/types').ManagerInstruction.payloadVariantDescriptors)[number]['name'];

function envelope(variant: ManagerVariant, payload: Uint8Array): Uint8Array {
  return new ManagerInstructionBuilder()
    .payload()
    .select(variant)
    .writePayload(payload)
    .finish()
    .build();
}

function validateIndices(args: {
  metaAccountIdx: number;
  programAccountIdx: number;
}): void {
  assertU16(args.metaAccountIdx, 'metaAccountIdx');
  assertU16(args.programAccountIdx, 'programAccountIdx');
}

function validateProof(proof: Uint8Array, label: string): Uint8Array {
  const result = StateProof.validate(proof);
  if (!result.ok || result.consumed !== proof.length) {
    throw new Error(`${label} is not a complete state proof`);
  }
  return proof;
}

function buildCreateBase(args: {
  metaAccountIdx: number;
  programAccountIdx: number;
  sourceBufferAccountIdx: number;
  sourceOffset?: number;
  sourceSize: number;
  authorityAccountIdx: number;
  seed: string | Uint8Array;
}): Uint8Array {
  validateIndices(args);
  assertU16(args.sourceBufferAccountIdx, 'sourceBufferAccountIdx');
  assertU16(args.authorityAccountIdx, 'authorityAccountIdx');
  assertU32(args.sourceOffset ?? 0, 'sourceOffset');
  assertU32(args.sourceSize, 'sourceSize');
  const builder = new CreateEphemeralArgsBuilder()
    .set_meta_account_idx(args.metaAccountIdx)
    .set_program_account_idx(args.programAccountIdx)
    .set_srcbuf_account_idx(args.sourceBufferAccountIdx)
    .set_srcbuf_offset(args.sourceOffset ?? 0)
    .set_srcbuf_size(args.sourceSize)
    .set_authority_account_idx(args.authorityAccountIdx);
  builder.seed().write(normalizeSeed(args.seed)).finish();
  return builder.build();
}

export function buildManagerInstructionBytes(
  args: ManagerInstructionArgs
): Uint8Array {
  switch (args.kind) {
    case 'createPermanent': {
      const payload = concatBytes(
        buildCreateBase(args),
        validateProof(args.metaStateProof, 'metaStateProof'),
        validateProof(args.programStateProof, 'programStateProof')
      );
      return envelope('create_permanent', payload);
    }
    case 'createEphemeral':
      return envelope('create_ephemeral', buildCreateBase(args));
    case 'upgrade': {
      validateIndices(args);
      assertU16(args.sourceBufferAccountIdx, 'sourceBufferAccountIdx');
      assertU32(args.sourceOffset ?? 0, 'sourceOffset');
      assertU32(args.sourceSize, 'sourceSize');
      return envelope(
        'upgrade',
        new UpgradeArgsBuilder()
          .set_meta_account_idx(args.metaAccountIdx)
          .set_program_account_idx(args.programAccountIdx)
          .set_srcbuf_account_idx(args.sourceBufferAccountIdx)
          .set_srcbuf_offset(args.sourceOffset ?? 0)
          .set_srcbuf_size(args.sourceSize)
          .build()
      );
    }
    case 'setPause':
      validateIndices(args);
      return envelope(
        'set_pause',
        new SetPauseArgsBuilder()
          .set_meta_account_idx(args.metaAccountIdx)
          .set_program_account_idx(args.programAccountIdx)
          .set_is_paused(args.paused ? 1 : 0)
          .build()
      );
    case 'destroy':
    case 'finalize':
    case 'claimAuthority':
      validateIndices(args);
      return envelope(
        args.kind === 'claimAuthority' ? 'claim_authority' : args.kind,
        new HeaderOnlyArgsBuilder()
          .set_meta_account_idx(args.metaAccountIdx)
          .set_program_account_idx(args.programAccountIdx)
          .build()
      );
    case 'setAuthority':
      validateIndices(args);
      return envelope(
        'set_authority',
        new SetAuthorityArgsBuilder()
          .set_meta_account_idx(args.metaAccountIdx)
          .set_program_account_idx(args.programAccountIdx)
          .set_authority_candidate(
            exactBytes(args.authorityCandidate, 32, 'authorityCandidate')
          )
          .build()
      );
  }
}

function commonIndices(
  context: Parameters<InstructionData>[0],
  args: { metaAccount: Uint8Array; programAccount: Uint8Array }
): { metaAccountIdx: number; programAccountIdx: number } {
  return {
    metaAccountIdx: accountIndex(context, args.metaAccount, 'metaAccount'),
    programAccountIdx: accountIndex(
      context,
      args.programAccount,
      'programAccount'
    ),
  };
}

export function createPermanentProgramInstruction(
  args: CreatePermanentProgramInstructionArgs
): InstructionData {
  return async (context) =>
    buildManagerInstructionBytes({
      kind: 'createPermanent',
      ...commonIndices(context, args),
      sourceBufferAccountIdx: accountIndex(
        context,
        args.sourceBufferAccount,
        'sourceBufferAccount'
      ),
      authorityAccountIdx: accountIndex(
        context,
        args.authorityAccount,
        'authorityAccount'
      ),
      sourceOffset: args.sourceOffset,
      sourceSize: args.sourceSize,
      seed: args.seed,
      metaStateProof: args.metaStateProof,
      programStateProof: args.programStateProof,
    });
}

export function createEphemeralProgramInstruction(
  args: CreateEphemeralProgramInstructionArgs
): InstructionData {
  return async (context) =>
    buildManagerInstructionBytes({
      kind: 'createEphemeral',
      ...commonIndices(context, args),
      sourceBufferAccountIdx: accountIndex(
        context,
        args.sourceBufferAccount,
        'sourceBufferAccount'
      ),
      authorityAccountIdx: accountIndex(
        context,
        args.authorityAccount,
        'authorityAccount'
      ),
      sourceOffset: args.sourceOffset,
      sourceSize: args.sourceSize,
      seed: args.seed,
    });
}

export function createUpgradeProgramInstruction(
  args: UpgradeProgramInstructionArgs
): InstructionData {
  return async (context) =>
    buildManagerInstructionBytes({
      kind: 'upgrade',
      ...commonIndices(context, args),
      sourceBufferAccountIdx: accountIndex(
        context,
        args.sourceBufferAccount,
        'sourceBufferAccount'
      ),
      sourceOffset: args.sourceOffset,
      sourceSize: args.sourceSize,
    });
}

export function createSetPauseInstruction(
  args: SetPauseInstructionArgs
): InstructionData {
  return async (context) =>
    buildManagerInstructionBytes({
      kind: 'setPause',
      ...commonIndices(context, args),
      paused: args.paused,
    });
}

function headerInstruction(
  kind: 'destroy' | 'finalize' | 'claimAuthority',
  args:
    | DestroyProgramInstructionArgs
    | FinalizeProgramInstructionArgs
    | ClaimAuthorityInstructionArgs
): InstructionData {
  return async (context) =>
    buildManagerInstructionBytes({
      kind,
      ...commonIndices(context, args),
    });
}

export function createDestroyProgramInstruction(
  args: DestroyProgramInstructionArgs
): InstructionData {
  return headerInstruction('destroy', args);
}

export function createFinalizeProgramInstruction(
  args: FinalizeProgramInstructionArgs
): InstructionData {
  return headerInstruction('finalize', args);
}

export function createClaimAuthorityInstruction(
  args: ClaimAuthorityInstructionArgs
): InstructionData {
  return headerInstruction('claimAuthority', args);
}

export function createSetAuthorityInstruction(
  args: SetAuthorityInstructionArgs
): InstructionData {
  return async (context) =>
    buildManagerInstructionBytes({
      kind: 'setAuthority',
      ...commonIndices(context, args),
      authorityCandidate: args.authorityCandidate,
    });
}
