import type {
  DeployProgressPhase,
  DeploymentOperation,
  UploadCleanupResult,
} from "./types";

export type DeployErrorCode =
  | "INVALID_INPUT"
  | "SIGNER_MISMATCH"
  | "TARGET_EXISTS"
  | "TARGET_NOT_FOUND"
  | "TARGET_FINALIZED"
  | "UPLOAD_CONFLICT"
  | "TRANSACTION_FAILED"
  | "VERIFICATION_FAILED"
  | "OUTCOME_UNKNOWN"
  | "RPC_ERROR";

export interface DeployErrorOptions {
  operation?: DeploymentOperation;
  phase?: DeployProgressPhase;
  transactionSignature?: string;
  vmError?: number;
  userErrorCode?: bigint;
  addresses?: Record<string, string>;
  cleanup?: UploadCleanupResult[];
  cause?: unknown;
}

export class DeployError extends Error {
  readonly code: DeployErrorCode;
  readonly operation?: DeploymentOperation;
  readonly phase?: DeployProgressPhase;
  readonly transactionSignature?: string;
  readonly vmError?: number;
  readonly userErrorCode?: bigint;
  addresses?: Record<string, string>;
  cleanup?: UploadCleanupResult[];

  constructor(
    code: DeployErrorCode,
    message: string,
    options: DeployErrorOptions = {},
  ) {
    super(message);
    if (options.cause !== undefined) {
      Object.defineProperty(this, "cause", {
        configurable: true,
        value: options.cause,
      });
    }
    this.name = "DeployError";
    this.code = code;
    this.operation = options.operation;
    this.phase = options.phase;
    this.transactionSignature = options.transactionSignature;
    this.vmError = options.vmError;
    this.userErrorCode = options.userErrorCode;
    this.addresses = options.addresses;
    this.cleanup = options.cleanup;
  }
}

export function asDeployError(
  error: unknown,
  code: DeployErrorCode,
  message: string,
  options: DeployErrorOptions = {},
): DeployError {
  if (error instanceof DeployError) return error;
  return new DeployError(code, message, { ...options, cause: error });
}
