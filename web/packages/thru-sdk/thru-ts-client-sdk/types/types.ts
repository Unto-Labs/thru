import { Pubkey } from "@thru/helpers";
import { StateProofType } from "../proto/thru/core/v1/state_pb";

export type GenerateStateProofOptions = {
    address?: Pubkey;
    proofType: StateProofType;
    targetSlot?: bigint;
}