import type { PubkeyInput } from "../domain/primitives";
import { StateProofType } from "../proto/thru/core/v1/state_pb";

export type GenerateStateProofOptions = {
    address?: PubkeyInput;
    proofType: StateProofType;
    targetSlot?: bigint;
}