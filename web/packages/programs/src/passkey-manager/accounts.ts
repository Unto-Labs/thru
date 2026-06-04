import { encodeAddress } from '@thru/sdk/helpers';
import {
  CredentialLookup,
  WalletAccount,
} from './abi/thru/program/passkey_manager/types';

/**
 * Parse wallet account data to extract nonce.
 */
export function parseWalletNonce(data: Uint8Array): bigint {
  const account = WalletAccount.from_array(data);
  if (!account) return 0n;
  return account.get_nonce();
}

/**
 * Fetch wallet nonce from the chain.
 * Takes an SDK-like object with accounts.get() method.
 */
export async function fetchWalletNonce(
  sdk: { accounts: { get: (address: string) => Promise<{ data?: { data?: Uint8Array } }> } },
  walletAddress: string
): Promise<bigint> {
  const account = await sdk.accounts.get(walletAddress);
  const data = account.data?.data;
  if (!data) return 0n;
  const parsed = WalletAccount.from_array(data);
  if (!parsed) return 0n;
  return parsed.get_nonce();
}

/* ------------------------------------------------------------------ */
/* Authority list parsing                                              */
/* ------------------------------------------------------------------ */

export type ParsedAuthority =
  | {
      idx: number;
      kind: 'passkey';
      x: Uint8Array;
      y: Uint8Array;
    }
  | {
      idx: number;
      kind: 'pubkey';
      pubkey: Uint8Array;
    }
  | {
      idx: number;
      kind: 'unknown';
      tag: number;
      data: Uint8Array;
    };

export interface WalletAuthorities {
  nonce: bigint;
  authorities: ParsedAuthority[];
}

const AUTHORITY_HEADER_BYTES = 9; /* num_auth (u8) + nonce (u64 LE) */
const AUTHORITY_ENTRY_BYTES = 65; /* tag (u8) + data (64) */

function readU64LE(data: Uint8Array, offset: number): bigint {
  if (offset + 8 > data.length) {
    throw new Error('Out of bounds');
  }
  let value = 0n;
  for (let i = 0; i < 8; i++) {
    value |= BigInt(data[offset + i]) << (8n * BigInt(i));
  }
  return value;
}

/**
 * Parse the on-chain WalletAccount data buffer into its nonce and full
 * authority list. The on-chain layout is:
 *
 *   num_auth: u8
 *   nonce:    u64 LE
 *   authorities[num_auth + 1]: { tag: u8, data: [u8; 64] }
 *
 * (`num_auth + 1` because num_auth stores the count minus one.)
 */
export function parseWalletAuthorities(data: Uint8Array): WalletAuthorities {
  if (data.length < AUTHORITY_HEADER_BYTES) {
    throw new Error('Wallet data too small');
  }

  const numAuth = data[0];
  const nonce = readU64LE(data, 1);

  const count = numAuth + 1;
  const required =
    AUTHORITY_HEADER_BYTES + count * AUTHORITY_ENTRY_BYTES;
  if (data.length < required) {
    throw new Error('Wallet data truncated');
  }

  const authorities: ParsedAuthority[] = [];
  for (let idx = 0; idx < count; idx++) {
    const offset = AUTHORITY_HEADER_BYTES + idx * AUTHORITY_ENTRY_BYTES;
    const tag = data[offset];
    const payload = data.slice(offset + 1, offset + AUTHORITY_ENTRY_BYTES);

    if (tag === 1) {
      authorities.push({
        idx,
        kind: 'passkey',
        x: payload.slice(0, 32),
        y: payload.slice(32, 64),
      });
      continue;
    }

    if (tag === 2) {
      authorities.push({ idx, kind: 'pubkey', pubkey: payload.slice(0, 32) });
      continue;
    }

    authorities.push({ idx, kind: 'unknown', tag, data: payload });
  }

  return { nonce, authorities };
}

/**
 * Encode a 32-byte pubkey to its base58 wallet address representation.
 */
export function formatAuthorityPubkey(pubkey: Uint8Array): string {
  return encodeAddress(pubkey);
}

/**
 * Parse a CredentialLookup account and return the wallet account pubkey
 * stored inside it.
 */
export function parseCredentialLookupWallet(data: Uint8Array): Uint8Array | null {
  const lookup = CredentialLookup.from_array(data);
  if (!lookup) return null;
  const wallet = lookup.get_wallet() as unknown as { buffer?: Uint8Array };
  return wallet.buffer ? wallet.buffer.slice() : null;
}
