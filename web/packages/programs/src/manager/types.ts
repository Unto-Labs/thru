import type {
  AccountLookupContext,
  InstructionData,
  ProgramSeed,
} from '../utils/helpers.js';

export type { AccountLookupContext, InstructionData, ProgramSeed };

export interface ManagedProgramAddresses {
  programMetaAccountAddress: string;
  programMetaAccountBytes: Uint8Array;
  programAccountAddress: string;
  programAccountBytes: Uint8Array;
}

export interface ManagerProgramMetaInfo {
  authorityAddress: string;
  authorityCandidateAddress: string;
  version: bigint;
  state: number;
}

interface ManagerAccountIndices {
  metaAccountIdx: number;
  programAccountIdx: number;
}

interface ManagerCreateIndices extends ManagerAccountIndices {
  sourceBufferAccountIdx: number;
  sourceOffset?: number;
  sourceSize: number;
  /** SHA-256 of exactly the `sourceSize` bytes at `sourceOffset` in the source
   * buffer. The manager rejects any other bytes, so a buffer rewritten after
   * this instruction is signed or approved cannot be installed. */
  sourceSha256: Uint8Array;
  authorityAccountIdx: number;
  seed: ProgramSeed;
}

export type ManagerInstructionArgs =
  | (ManagerCreateIndices & {
      kind: 'createPermanent';
      metaStateProof: Uint8Array;
      programStateProof: Uint8Array;
    })
  | (ManagerCreateIndices & { kind: 'createEphemeral' })
  | (ManagerAccountIndices & {
      kind: 'upgrade';
      sourceBufferAccountIdx: number;
      sourceOffset?: number;
      sourceSize: number;
      sourceSha256: Uint8Array;
    })
  | (ManagerAccountIndices & { kind: 'setPause'; paused: boolean })
  | (ManagerAccountIndices & { kind: 'destroy' })
  | (ManagerAccountIndices & { kind: 'finalize' })
  | (ManagerAccountIndices & {
      kind: 'setAuthority';
      authorityCandidate: Uint8Array;
    })
  | (ManagerAccountIndices & { kind: 'claimAuthority' });

interface ManagerAccounts {
  metaAccount: Uint8Array;
  programAccount: Uint8Array;
}

interface ManagerCreateAccounts extends ManagerAccounts {
  sourceBufferAccount: Uint8Array;
  sourceOffset?: number;
  sourceSize: number;
  /** SHA-256 of exactly the `sourceSize` bytes at `sourceOffset` in the source
   * buffer. The manager rejects any other bytes, so a buffer rewritten after
   * this instruction is signed or approved cannot be installed. */
  sourceSha256: Uint8Array;
  authorityAccount: Uint8Array;
  seed: ProgramSeed;
}

export interface CreatePermanentProgramInstructionArgs
  extends ManagerCreateAccounts {
  metaStateProof: Uint8Array;
  programStateProof: Uint8Array;
}

export type CreateEphemeralProgramInstructionArgs = ManagerCreateAccounts;

export interface UpgradeProgramInstructionArgs extends ManagerAccounts {
  sourceBufferAccount: Uint8Array;
  sourceOffset?: number;
  sourceSize: number;
  /** SHA-256 of exactly the `sourceSize` bytes at `sourceOffset` in the source
   * buffer. The manager rejects any other bytes, so a buffer rewritten after
   * this instruction is signed or approved cannot be installed. */
  sourceSha256: Uint8Array;
}

export interface SetPauseInstructionArgs extends ManagerAccounts {
  paused: boolean;
}

export type DestroyProgramInstructionArgs = ManagerAccounts;
export type FinalizeProgramInstructionArgs = ManagerAccounts;
export type ClaimAuthorityInstructionArgs = ManagerAccounts;

export interface SetAuthorityInstructionArgs extends ManagerAccounts {
  authorityCandidate: Uint8Array;
}
