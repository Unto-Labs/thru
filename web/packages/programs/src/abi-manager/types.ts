import type {
  AccountLookupContext,
  InstructionData,
} from '../utils/helpers';

export type { AccountLookupContext, InstructionData };

export interface ProgramABIAddresses {
  abiMetaAccountAddress: string;
  abiMetaAccountBytes: Uint8Array;
  abiAccountAddress: string;
  abiAccountBytes: Uint8Array;
}

export interface OfficialABIMetaAccountInfo {
  kind: 'official';
  version: number;
  flags: number;
  programAddress: string;
}

export interface ExternalABIMetaAccountInfo {
  kind: 'external';
  version: number;
  flags: number;
  publisherAddress: string;
  targetProgramAddress: string;
  seed: Uint8Array;
}

export type ABIMetaAccountInfo =
  | OfficialABIMetaAccountInfo
  | ExternalABIMetaAccountInfo;

export interface ABIAccountInfo {
  abiMetaAccountAddress: string;
  revision: bigint;
  state: number;
  contents: Uint8Array;
}

interface MetaOfficialIndices {
  abiMetaAccountIdx: number;
  programMetaAccountIdx: number;
  authorityAccountIdx: number;
}

interface MetaExternalIndices {
  abiMetaAccountIdx: number;
  authorityAccountIdx: number;
  targetProgram: Uint8Array;
  seed: Uint8Array;
}

interface ABIOfficialIndices extends MetaOfficialIndices {
  abiAccountIdx: number;
  sourceBufferAccountIdx: number;
  sourceOffset?: number;
  sourceSize: number;
}

interface ABIExternalIndices {
  abiMetaAccountIdx: number;
  abiAccountIdx: number;
  sourceBufferAccountIdx: number;
  sourceOffset?: number;
  sourceSize: number;
  authorityAccountIdx: number;
}

interface OfficialControlIndices extends MetaOfficialIndices {
  abiAccountIdx: number;
}

interface ExternalControlIndices {
  abiMetaAccountIdx: number;
  abiAccountIdx: number;
  authorityAccountIdx: number;
}

export type ABIManagerInstructionArgs =
  | (MetaOfficialIndices & {
      kind: 'createMetaOfficialPermanent';
      stateProof: Uint8Array;
    })
  | (MetaOfficialIndices & { kind: 'createMetaOfficialEphemeral' })
  | (MetaExternalIndices & {
      kind: 'createMetaExternalPermanent';
      stateProof: Uint8Array;
    })
  | (MetaExternalIndices & { kind: 'createMetaExternalEphemeral' })
  | (ABIOfficialIndices & {
      kind: 'createABIOfficialPermanent';
      stateProof: Uint8Array;
    })
  | (ABIOfficialIndices & { kind: 'createABIOfficialEphemeral' })
  | (ABIExternalIndices & {
      kind: 'createABIExternalPermanent';
      stateProof: Uint8Array;
    })
  | (ABIExternalIndices & { kind: 'createABIExternalEphemeral' })
  | (ABIOfficialIndices & { kind: 'upgradeABIOfficial' })
  | (ABIExternalIndices & { kind: 'upgradeABIExternal' })
  | (OfficialControlIndices & { kind: 'closeABIOfficial' })
  | (ExternalControlIndices & { kind: 'closeABIExternal' })
  | (OfficialControlIndices & { kind: 'finalizeABIOfficial' })
  | (ExternalControlIndices & { kind: 'finalizeABIExternal' });

export type AccountCreationMode =
  | { ephemeral: true; stateProof?: never }
  | { ephemeral?: false; stateProof: Uint8Array };

export interface OfficialABIMetaAccounts {
  abiMetaAccount: Uint8Array;
  programMetaAccount: Uint8Array;
  authorityAccount: Uint8Array;
}

export interface ExternalABIMetaAccounts {
  abiMetaAccount: Uint8Array;
  authorityAccount: Uint8Array;
  targetProgram: Uint8Array;
  seed: Uint8Array;
}

export interface OfficialABIAccounts extends OfficialABIMetaAccounts {
  abiAccount: Uint8Array;
  sourceBufferAccount: Uint8Array;
  sourceOffset?: number;
  sourceSize: number;
}

export interface ExternalABIAccounts {
  abiMetaAccount: Uint8Array;
  abiAccount: Uint8Array;
  sourceBufferAccount: Uint8Array;
  sourceOffset?: number;
  sourceSize: number;
  authorityAccount: Uint8Array;
}

export interface OfficialABIControlAccounts extends OfficialABIMetaAccounts {
  abiAccount: Uint8Array;
}

export interface ExternalABIControlAccounts {
  abiMetaAccount: Uint8Array;
  abiAccount: Uint8Array;
  authorityAccount: Uint8Array;
}
