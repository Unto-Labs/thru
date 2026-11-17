import { encodeAddress } from '@thru/sdk/helpers';
import type { Account } from '@thru/sdk';
import { Pubkey as AbiPubkey } from './abi/thru/common/primitives/types';
import {
  TickerField,
  TokenAccount,
  TokenMintAccount,
  TokenProgramAccount,
} from './abi/thru/program/token/types';
import type { MintAccountInfo, TokenAccountInfo } from './types';
import { decodeAccountRoot } from '../utils/account-root';

const TEXT_DECODER = new TextDecoder();

export function parseMintAccountData(account: Account): MintAccountInfo {
  const data = account.data?.data;
  if (!data) {
    throw new Error('Mint account data is missing');
  }

  const parsed = decodeTokenMintAccount(data);
  if (!parsed) {
    throw new Error('Account data is not a token mint');
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

  const parsed = decodeTokenAccount(data);
  if (!parsed) {
    throw new Error('Account data is not a token account');
  }

  return {
    mint: encodeAddress(pubkeyToBytes(parsed.get_mint())),
    owner: encodeAddress(pubkeyToBytes(parsed.get_owner())),
    amount: parsed.get_amount(),
    isFrozen: parsed.get_is_frozen() === 1,
  };
}

/**
 * Decodes Token Program account data through its account root. Byte 0 is the
 * account type (mint or token account); returns null for any other type or a
 * buffer whose size does not match that type exactly.
 */
export function decodeTokenProgramAccount(data: Uint8Array): TokenProgramAccount | null {
  return decodeAccountRoot(data, (bytes) => TokenProgramAccount.from_array(bytes));
}

/** Decodes mint account data; null when the bytes are not a token mint. */
export function decodeTokenMintAccount(data: Uint8Array): TokenMintAccount | null {
  return decodeTokenProgramAccount(data)?.payload().asMintV1() ?? null;
}

/** Decodes token account data; null when the bytes are not a token account. */
export function decodeTokenAccount(data: Uint8Array): TokenAccount | null {
  return decodeTokenProgramAccount(data)?.payload().asTokenAccountV1() ?? null;
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
