import {
  ConsensusStatus,
  Signature,
  SubmissionStatus,
  type InstructionContext,
} from "@thru/sdk";
import type { Thru } from "@thru/sdk/client";
import { StateProofType } from "@thru/sdk/proto";
import { TRANSACTION_TIMEOUT_MS } from "./constants";
import { DeployError, asDeployError } from "./errors";
import type {
  DeployProgressEvent,
  DeployProgressPhase,
  DeploymentOperation,
} from "./types";
import type { ResolvedSigner } from "./validation";

export interface DeploymentTransaction {
  program: string;
  readWrite?: string[];
  readOnly?: string[];
  instructionData:
    | Uint8Array
    | ((context: InstructionContext) => Uint8Array | Promise<Uint8Array>);
  computeUnits?: number;
  stateUnits?: number;
  memoryUnits?: number;
  expiryAfter?: number;
}

export function emitProgress(
  onProgress: ((event: DeployProgressEvent) => void) | undefined,
  event: DeployProgressEvent,
): void {
  if (!onProgress) return;
  try {
    onProgress(event);
  } catch {
    /* Progress observers cannot change deployment behavior. */
  }
}

export async function creationProof(
  client: Thru,
  address: string,
  ephemeral: boolean,
): Promise<Uint8Array> {
  if (ephemeral) return new Uint8Array();
  try {
    const proof = await client.proofs.generate({
      address,
      proofType: StateProofType.CREATING,
    });
    if (!proof.proof.length) {
      throw new Error("empty state proof");
    }
    return proof.proof;
  } catch (error) {
    throw asDeployError(
      error,
      "RPC_ERROR",
      `Failed to create state proof for ${address}`,
    );
  }
}

export async function submitTransaction(
  client: Thru,
  signer: ResolvedSigner,
  operation: DeploymentOperation,
  phase: DeployProgressPhase,
  transaction: DeploymentTransaction,
): Promise<string> {
  let rawTransaction: Uint8Array;
  let signature: string | undefined;
  try {
    const signed = await client.transactions.buildAndSign({
      feePayer: {
        publicKey: signer.publicKey,
        privateKey: signer.privateKey,
      },
      program: transaction.program,
      header: {
        fee: 0n,
        computeUnits: transaction.computeUnits ?? 500_000_000,
        stateUnits: transaction.stateUnits ?? 5_000,
        memoryUnits: transaction.memoryUnits ?? 5_000,
        expiryAfter: transaction.expiryAfter ?? 10_000,
      },
      accounts: {
        readWrite: transaction.readWrite,
        readOnly: transaction.readOnly,
      },
      instructionData: transaction.instructionData,
    });
    rawTransaction = signed.rawTransaction;
    signature = signed.signature.toThruFmt();
  } catch (error) {
    throw asDeployError(
      error,
      "RPC_ERROR",
      "Failed to build deployment transaction",
      {
        operation,
        phase,
      },
    );
  }

  let accepted = false;
  let finalized = false;
  try {
    for await (const update of client.transactions.sendAndTrack(
      rawTransaction,
      {
        timeoutMs: TRANSACTION_TIMEOUT_MS,
      },
    )) {
      if (update.signature?.value) {
        signature = Signature.from(update.signature.value).toThruFmt();
      }
      if (update.status === SubmissionStatus.ACCEPTED) accepted = true;
      if (
        update.consensusStatus === ConsensusStatus.FINALIZED ||
        update.consensusStatus === ConsensusStatus.CLUSTER_EXECUTED
      ) {
        finalized = true;
      }
      if (!update.executionResult) continue;

      const { vmError, userErrorCode } = update.executionResult;
      if (vmError !== 0 || userErrorCode !== 0n) {
        throw new DeployError(
          "TRANSACTION_FAILED",
          "Deployment transaction failed",
          {
            operation,
            phase,
            transactionSignature: signature,
            vmError,
            userErrorCode,
          },
        );
      }
      return signature;
    }
  } catch (error) {
    if (error instanceof DeployError) throw error;
    throw new DeployError(
      "OUTCOME_UNKNOWN",
      accepted || finalized
        ? "Transaction was submitted but its final outcome is unknown"
        : "Transaction submission may have succeeded, but no outcome was received",
      { operation, phase, transactionSignature: signature, cause: error },
    );
  }

  throw new DeployError(
    "OUTCOME_UNKNOWN",
    "Transaction tracking ended before execution was confirmed",
    { operation, phase, transactionSignature: signature },
  );
}
