import type { Thru } from "@thru/sdk/client";

export type DeploymentBytes = Uint8Array | ArrayBuffer | ArrayBufferView;

export type DeploymentPrivateKey = Uint8Array | string;

export interface DeploymentSigner {
  address: string;
  privateKey: DeploymentPrivateKey;
}

export type DeploymentOperation =
  "deployProgram" | "deployProgramABI" | "upgradeProgram" | "upgradeProgramABI";

export type DeployProgressPhase =
  "validation" | "preflight" | "upload" | "commit" | "verification" | "cleanup";

export type DeployProgressStatus =
  "started" | "progress" | "succeeded" | "failed";

export interface DeployProgressEvent {
  operation: DeploymentOperation;
  phase: DeployProgressPhase;
  status: DeployProgressStatus;
  artifact?: "program" | "abi";
  uploadStep?: "create" | "write" | "finalize";
  completedChunks?: number;
  totalChunks?: number;
  signature?: string;
  message?: string;
}

export interface DeploymentRequestBase {
  seed: string;
  signer: DeploymentSigner;
  client?: Thru;
  ephemeral?: boolean;
  chunkSize?: number;
  onProgress?: (event: DeployProgressEvent) => void;
}

interface ProgramMutationRequest extends DeploymentRequestBase {
  program: DeploymentBytes;
  abi?: DeploymentBytes;
}

interface ProgramABIMutationRequest extends DeploymentRequestBase {
  abi: DeploymentBytes;
  programAddress?: string;
}

export type DeployProgramRequest = ProgramMutationRequest;

export type DeployProgramABIRequest = ProgramABIMutationRequest;

export type UpgradeProgramRequest = ProgramMutationRequest & {
  programAddress?: string;
};

export type UpgradeProgramABIRequest = ProgramABIMutationRequest;

export type UploadCleanupResult =
  | { status: "succeeded"; transactionSignature: string }
  | { status: "not-needed" }
  | {
      status: "failed";
      error: string;
      transactionSignature?: string;
      remainingAccountAddresses?: string[];
    };

export interface UploadArtifactResult {
  artifact: "program" | "abi";
  size: number;
  sha256: string;
  metaAccountAddress: string;
  bufferAccountAddress: string;
  reused: boolean;
  transactionSignatures: string[];
  cleanup: UploadCleanupResult;
}

interface ManagedProgramResultBase {
  seed: string;
  ephemeral: boolean;
  authorityAddress: string;
  programMetaAccountAddress: string;
  programAccountAddress: string;
  programVersion: bigint;
  transactionSignature: string;
  warnings: string[];
}

interface ABIResultFields {
  abiMetaAccountAddress: string;
  abiAccountAddress: string;
  abiRevision: bigint;
}

interface ProgramMutationResult extends ManagedProgramResultBase {
  programSize: number;
  abiSize?: number;
  abiMetaAccountAddress?: string;
  abiAccountAddress?: string;
  abiRevision?: bigint;
  programUpload: UploadArtifactResult;
  abiUpload?: UploadArtifactResult;
}

interface ProgramABIMutationResult
  extends ManagedProgramResultBase, ABIResultFields {
  abiSize: number;
  abiUpload: UploadArtifactResult;
}

export type DeployProgramResult = ProgramMutationResult;

export type DeployProgramABIResult = ProgramABIMutationResult;

export type UpgradeProgramResult = ProgramMutationResult;

export type UpgradeProgramABIResult = ProgramABIMutationResult;

export interface InspectProgramDeploymentRequest {
  client: Thru;
  seed: string;
  ephemeral?: boolean;
  authorityAddress?: string;
  expectedProgramBytes?: Uint8Array;
  inspectABI?: boolean;
  expectedABIBytes?: Uint8Array;
}

interface MissingAccountPair {
  status: "missing";
  metadataPresent: false;
  accountPresent: false;
}

interface PartialAccountPair {
  status: "partial";
  metadataPresent: boolean;
  accountPresent: boolean;
}

export type ProgramAccountInspection =
  | MissingAccountPair
  | PartialAccountPair
  | {
      status: "present";
      metadataPresent: true;
      accountPresent: true;
      authorityAddress: string;
      version: bigint;
      state: number;
      bytesMatch?: boolean;
    };

export type ABIAccountInspection =
  | MissingAccountPair
  | PartialAccountPair
  | {
      status: "present";
      metadataPresent: true;
      accountPresent: true;
      revision: bigint;
      state: number;
      bytesMatch?: boolean;
    };

export interface ProgramDeploymentInspection {
  programMetaAccountAddress: string;
  programAccountAddress: string;
  abiMetaAccountAddress: string;
  abiAccountAddress: string;
  program: ProgramAccountInspection;
  abi?: ABIAccountInspection;
}
