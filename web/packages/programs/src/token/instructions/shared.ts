import {
  TickerFieldBuilder,
  TokenInstruction,
  TokenInstructionBuilder,
} from '../abi/thru/program/token/types';
import { TICKER_MAX_LENGTH } from '../constants';

import type { AccountLookupContext } from '../types';

export type { AccountLookupContext };

const TEXT_ENCODER = new TextEncoder();

/**
 * Encodes a ticker as the ABI `TickerField`: one length byte, then 8 ticker
 * bytes padded with zeros. A string is encoded as UTF-8 exactly as given.
 */
export function encodeTickerField(ticker: string | Uint8Array): Uint8Array {
  const tickerBytes = typeof ticker === 'string' ? TEXT_ENCODER.encode(ticker) : ticker;
  if (tickerBytes.length > TICKER_MAX_LENGTH) {
    throw new Error('Ticker must be 8 characters or less');
  }

  const padded = new Uint8Array(TICKER_MAX_LENGTH);
  padded.set(tickerBytes);

  return new TickerFieldBuilder()
    .set_length(tickerBytes.length)
    .set_bytes(Array.from(padded))
    .build();
}

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
