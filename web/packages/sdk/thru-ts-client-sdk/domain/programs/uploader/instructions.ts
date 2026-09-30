import {
  CreateArgsBuilder,
  DestroyArgsBuilder,
  FinalizeArgsBuilder,
  UploaderInstruction,
  UploaderInstructionBuilder,
  WriteArgsBuilder,
} from './abi/thru/program/uploader/types';
import {
  accountIndex,
  assertU16,
  assertU32,
  exactBytes,
  normalizeSeed,
  type AccountLookupContext,
  type InstructionData,
} from '../utils/helpers';
import type {
  CreateUploadBufferInstructionArgs,
  DestroyUploadInstructionArgs,
  FinalizeUploadInstructionArgs,
  UploaderInstructionArgs,
  WriteUploadInstructionArgs,
} from './types';

type UploaderVariant =
  (typeof UploaderInstruction.payloadVariantDescriptors)[number]['name'];

function envelope(
  variant: UploaderVariant,
  payload: Uint8Array
): Uint8Array {
  return new UploaderInstructionBuilder()
    .payload()
    .select(variant)
    .writePayload(payload)
    .finish()
    .build();
}

function validateIndices(args: {
  bufferAccountIdx: number;
  metaAccountIdx: number;
}): void {
  assertU16(args.bufferAccountIdx, 'bufferAccountIdx');
  assertU16(args.metaAccountIdx, 'metaAccountIdx');
}

export function buildUploaderInstructionBytes(
  args: UploaderInstructionArgs
): Uint8Array {
  validateIndices(args);
  switch (args.kind) {
    case 'create': {
      assertU16(args.authorityAccountIdx, 'authorityAccountIdx');
      assertU32(args.bufferSize, 'bufferSize');
      const builder = new CreateArgsBuilder()
        .set_buffer_account_idx(args.bufferAccountIdx)
        .set_meta_account_idx(args.metaAccountIdx)
        .set_authority_account_idx(args.authorityAccountIdx)
        .set_buffer_account_sz(args.bufferSize)
        .set_expected_account_hash(
          exactBytes(args.expectedHash, 32, 'expectedHash')
        );
      builder.seed().write(normalizeSeed(args.seed)).finish();
      return envelope('create', builder.build());
    }
    case 'write': {
      assertU32(args.offset, 'offset');
      assertU32(args.data.length, 'data length');
      const builder = new WriteArgsBuilder()
        .set_buffer_account_idx(args.bufferAccountIdx)
        .set_meta_account_idx(args.metaAccountIdx)
        .set_data_offset(args.offset);
      builder.data().write(args.data).finish();
      return envelope('write', builder.build());
    }
    case 'destroy':
      return envelope(
        'destroy',
        new DestroyArgsBuilder()
          .set_buffer_account_idx(args.bufferAccountIdx)
          .set_meta_account_idx(args.metaAccountIdx)
          .build()
      );
    case 'finalize':
      return envelope(
        'finalize',
        new FinalizeArgsBuilder()
          .set_buffer_account_idx(args.bufferAccountIdx)
          .set_meta_account_idx(args.metaAccountIdx)
          .set_expected_account_hash(
            exactBytes(args.expectedHash, 32, 'expectedHash')
          )
          .build()
      );
  }
}

function indices(
  context: AccountLookupContext,
  args: { bufferAccount: Uint8Array; metaAccount: Uint8Array }
): { bufferAccountIdx: number; metaAccountIdx: number } {
  return {
    bufferAccountIdx: accountIndex(
      context,
      args.bufferAccount,
      'bufferAccount'
    ),
    metaAccountIdx: accountIndex(context, args.metaAccount, 'metaAccount'),
  };
}

export function createUploadBufferInstruction(
  args: CreateUploadBufferInstructionArgs
): InstructionData {
  return async (context) =>
    buildUploaderInstructionBytes({
      kind: 'create',
      ...indices(context, args),
      authorityAccountIdx: accountIndex(
        context,
        args.authorityAccount,
        'authorityAccount'
      ),
      bufferSize: args.bufferSize,
      expectedHash: args.expectedHash,
      seed: args.seed,
    });
}

export function createWriteUploadInstruction(
  args: WriteUploadInstructionArgs
): InstructionData {
  return async (context) =>
    buildUploaderInstructionBytes({
      kind: 'write',
      ...indices(context, args),
      data: args.data,
      offset: args.offset,
    });
}

export function createDestroyUploadInstruction(
  args: DestroyUploadInstructionArgs
): InstructionData {
  return async (context) =>
    buildUploaderInstructionBytes({
      kind: 'destroy',
      ...indices(context, args),
    });
}

export function createFinalizeUploadInstruction(
  args: FinalizeUploadInstructionArgs
): InstructionData {
  return async (context) =>
    buildUploaderInstructionBytes({
      kind: 'finalize',
      ...indices(context, args),
      expectedHash: args.expectedHash,
    });
}
