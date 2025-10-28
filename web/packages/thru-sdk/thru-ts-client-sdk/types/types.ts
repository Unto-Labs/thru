import { BytesLike } from "../modules/helpers";
import { StateProofType } from "../proto/thru/core/v1/state_pb";

export type GenerateStateProofOptions = {
    address?: BytesLike;
    proofType: StateProofType;
    targetSlot: bigint;
}