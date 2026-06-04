import type { PubkeyInput } from "../domain/primitives";
import { StateProofType } from "@thru/sdk/proto";

export type GenerateStateProofOptions = {
    address?: PubkeyInput;
    proofType: StateProofType;
    targetSlot?: bigint;
}