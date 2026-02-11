import { encodeAddress } from '@thru/helpers';
import type { Account } from '@thru/thru-sdk';
import { Pubkey as AbiPubkey } from './abi/thru/common/primitives/types';
import {
  TickerField,
  TokenAccount,
  TokenMintAccount,
} from './abi/thru/program/token/types';
import type { MintAccountInfo, TokenAccountInfo } from './types';

const TEXT_DECODER = new TextDecoder();

export function parseMintAccountData(account: Account): MintAccountInfo {
  const data = account.data?.data;
  if (!data) {
    throw new Error('Mint account data is missing');
  }

  const parsed = TokenMintAccount.from_array(data);
  if (!parsed) {
    throw new Error('Mint account data is malformed');
  }

  const hasFreezeAuthority = parsed.get_has_freeze_authority() === 1;
  const freezeAuthority = hasFreezeAuthority
    ? encodeAddress(pubkeyToBytes(parsed.get_freeze_authority()))
    : null;

  return {
    decimals: parsed.get_decimals(),
    supply: parsed.get_supply(),
    creator: encodeAddress(pubkeyToBytes(parsed.get_creator())),
    mintAuthority: encodeAddress(pubkeyToBytes(parsed.get_mint_authority())),
    freezeAuthority,
    hasFreezeAuthority,
    ticker: decodeTicker(parsed.get_ticker()),
  };
}

export function parseTokenAccountData(account: Account): TokenAccountInfo {
  const data = account.data?.data;
  if (!data) {
    throw new Error('Token account data is missing');
  }

  const parsed = TokenAccount.from_array(data);
  if (!parsed) {
    throw new Error('Token account data is malformed');
  }

  return {
    mint: encodeAddress(pubkeyToBytes(parsed.get_mint())),
    owner: encodeAddress(pubkeyToBytes(parsed.get_owner())),
    amount: parsed.get_amount(),
    isFrozen: parsed.get_is_frozen() === 1,
  };
}

export function isAccountNotFoundError(err: unknown): boolean {
  if (!err) return false;
  return (err as { code?: number }).code === 5;
}

function pubkeyToBytes(pubkey: AbiPubkey): Uint8Array {
  return Uint8Array.from(pubkey.bytes);
}

function decodeTicker(field: TickerField): string {
  const length = field.get_length();
  const bytes = Uint8Array.from(field.get_bytes()).slice(0, length);
  return TEXT_DECODER.decode(bytes).replace(/\0+$/, '');
}
