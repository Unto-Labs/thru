export { DeployError } from "./errors";
export type { DeployErrorCode, DeployErrorOptions } from "./errors";
export {
  deployProgram,
  deployProgramABI,
  upgradeProgram,
  upgradeProgramABI,
} from "./workflows";
export { inspectProgramDeployment } from "./inspection";
export type {
  ABIAccountInspection,
  DeployProgramABIRequest,
  DeployProgramABIResult,
  DeployProgramRequest,
  DeployProgramResult,
  DeployProgressEvent,
  DeploymentBytes,
  DeploymentPrivateKey,
  DeploymentRequestBase,
  DeploymentSigner,
  InspectProgramDeploymentRequest,
  ProgramAccountInspection,
  ProgramDeploymentInspection,
  UpgradeProgramABIRequest,
  UpgradeProgramABIResult,
  UpgradeProgramRequest,
  UpgradeProgramResult,
  UploadArtifactResult,
  UploadCleanupResult,
} from "./types";

import {
  deployProgram,
  deployProgramABI,
  upgradeProgram,
  upgradeProgramABI,
} from "./workflows";

export const deploy = Object.freeze({
  deployProgram,
  deployProgramABI,
  upgradeProgram,
  upgradeProgramABI,
});
