import type {
  AccountLookupContext,
  InstructionData,
  ProgramSeed,
} from '../utils/helpers';

export type { AccountLookupContext, InstructionData, ProgramSeed };

export interface UploadAddresses {
  metaAccountAddress: string;
  metaAccountBytes: Uint8Array;
  bufferAccountAddress: string;
  bufferAccountBytes: Uint8Array;
}

export interface UploaderProgramMetaInfo {
  authorityAddress: string;
  expectedHash: Uint8Array;
  state: number;
}

interface UploadIndices {
  bufferAccountIdx: number;
  metaAccountIdx: number;
}

export type UploaderInstructionArgs =
  | (UploadIndices & {
      kind: 'create';
      authorityAccountIdx: number;
      bufferSize: number;
      expectedHash: Uint8Array;
      seed: ProgramSeed;
    })
  | (UploadIndices & {
      kind: 'write';
      data: Uint8Array;
      offset: number;
    })
  | (UploadIndices & { kind: 'destroy' })
  | (UploadIndices & {
      kind: 'finalize';
      expectedHash: Uint8Array;
    });

interface UploadAccounts {
  bufferAccount: Uint8Array;
  metaAccount: Uint8Array;
}

export interface CreateUploadBufferInstructionArgs extends UploadAccounts {
  authorityAccount: Uint8Array;
  bufferSize: number;
  expectedHash: Uint8Array;
  seed: ProgramSeed;
}

export interface WriteUploadInstructionArgs extends UploadAccounts {
  data: Uint8Array;
  offset: number;
}

export type DestroyUploadInstructionArgs = UploadAccounts;

export interface FinalizeUploadInstructionArgs extends UploadAccounts {
  expectedHash: Uint8Array;
}
