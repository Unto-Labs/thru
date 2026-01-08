import type { PubkeyInput } from "../domain/primitives";
import { StateProofType } from "@thru/proto";

export type GenerateStateProofOptions = {
    address?: PubkeyInput;
    proofType: StateProofType;
    targetSlot?: bigint;
}