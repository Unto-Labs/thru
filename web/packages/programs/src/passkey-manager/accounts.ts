import { encodeAddress } from '@thru/sdk/helpers';
import { LONG_LIVED_AUTHORITY_EXPIRY_SECONDS } from './constants';
import {
  CredentialLookup,
  WalletAccount,
} from './abi/thru/program/passkey_manager/types';

const LEGACY_WALLET_HEADER_BYTES = 9;
const LEGACY_AUTHORITY_BYTES = 65;
const AUTHORITY_DATA_BYTES = 64;

/**
 * Parse wallet account data to extract nonce.
 */
export function parseWalletNonce(data: Uint8Array): bigint {
  const account = WalletAccount.from_array(data);
  if (!account) return parseLegacyWalletNonce(data) ?? 0n;
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
  return parseWalletNonce(data);
}

/* ------------------------------------------------------------------ */
/* Authority list parsing                                              */
/* ------------------------------------------------------------------ */

export type ParsedAuthority =
  | {
      idx: number;
      expiresAtBlockTimeSeconds: bigint;
      kind: 'passkey';
      x: Uint8Array;
      y: Uint8Array;
    }
  | {
      idx: number;
      expiresAtBlockTimeSeconds: bigint;
      kind: 'pubkey';
      pubkey: Uint8Array;
    }
  | {
      idx: number;
      expiresAtBlockTimeSeconds: bigint;
      kind: 'unknown';
      tag: number;
      data: Uint8Array;
    };

export interface WalletAuthorities {
  nonce: bigint;
  authorities: ParsedAuthority[];
  layout: 'authorityRecord' | 'legacyAuthority';
}

/**
 * Parse the on-chain WalletAccount data buffer into its nonce and full
 * authority list using the generated ABI view.
 */
export function parseWalletAuthorities(data: Uint8Array): WalletAuthorities {
  const account = WalletAccount.from_array(data);
  if (!account) {
    const legacy = parseLegacyWalletAuthorities(data);
    if (legacy) return legacy;
    throw new Error('Wallet data truncated');
  }

  const authorities: ParsedAuthority[] = [];
  account.get_authorities().forEach((record, idx) => {
    const authority = record.get_authority();
    const tag = authority.get_tag();
    const payload = Uint8Array.from(authority.get_data());
    const expiresAtBlockTimeSeconds =
      record.get_expires_at_block_time_seconds();

    if (tag === 1) {
      authorities.push({
        idx,
        expiresAtBlockTimeSeconds,
        kind: 'passkey',
        x: payload.slice(0, 32),
        y: payload.slice(32, 64),
      });
      return;
    }

    if (tag === 2) {
      authorities.push({
        idx,
        expiresAtBlockTimeSeconds,
        kind: 'pubkey',
        pubkey: payload.slice(0, 32),
      });
      return;
    }

    authorities.push({ idx, expiresAtBlockTimeSeconds, kind: 'unknown', tag, data: payload });
  });

  return { nonce: account.get_nonce(), authorities, layout: 'authorityRecord' };
}

function parseLegacyWalletNonce(data: Uint8Array): bigint | null {
  if (data.length < LEGACY_WALLET_HEADER_BYTES) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getBigUint64(1, true);
}

function parseLegacyWalletAuthorities(data: Uint8Array): WalletAuthorities | null {
  if (data.length < LEGACY_WALLET_HEADER_BYTES) return null;

  const numAuth = data[0];
  const authorityCount = numAuth + 1;
  const requiredLength = LEGACY_WALLET_HEADER_BYTES + authorityCount * LEGACY_AUTHORITY_BYTES;
  if (data.length < requiredLength) return null;

  const nonce = parseLegacyWalletNonce(data);
  if (nonce === null) return null;

  const authorities: ParsedAuthority[] = [];
  for (let idx = 0; idx < authorityCount; idx += 1) {
    const offset = LEGACY_WALLET_HEADER_BYTES + idx * LEGACY_AUTHORITY_BYTES;
    const tag = data[offset];
    const payload = data.slice(offset + 1, offset + 1 + AUTHORITY_DATA_BYTES);
    const expiresAtBlockTimeSeconds = LONG_LIVED_AUTHORITY_EXPIRY_SECONDS;

    if (tag === 1) {
      authorities.push({
        idx,
        expiresAtBlockTimeSeconds,
        kind: 'passkey',
        x: payload.slice(0, 32),
        y: payload.slice(32, 64),
      });
      continue;
    }

    if (tag === 2) {
      authorities.push({
        idx,
        expiresAtBlockTimeSeconds,
        kind: 'pubkey',
        pubkey: payload.slice(0, 32),
      });
      continue;
    }

    authorities.push({ idx, expiresAtBlockTimeSeconds, kind: 'unknown', tag, data: payload });
  }

  return { nonce, authorities, layout: 'legacyAuthority' };
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
