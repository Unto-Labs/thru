import {
  TokenInstruction,
  TokenInstructionBuilder,
} from '../abi/thru/program/token/types';

import type { AccountLookupContext } from '../types';

export type { AccountLookupContext };

type TokenInstructionVariantName =
  (typeof TokenInstruction.payloadVariantDescriptors)[number]['name'];

export function buildTokenInstructionBytes(
  variant: TokenInstructionVariantName,
  payload: Uint8Array
): Uint8Array {
  const builder = new TokenInstructionBuilder();
  builder.payload().select(variant).writePayload(payload).finish();
  return builder.build();
}
