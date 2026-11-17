import { encodeAddress } from '@thru/sdk/helpers';
import {
  WalletAccount,
  WalletProgramAccount,
} from './abi/thru/program/wallet/types';
import { decodeAccountRoot } from '../utils/account-root';

/**
 * Decodes Wallet Program account data through its account root. Byte 0 is the
 * account type (wallet or credential lookup); returns null for any other
 * type, a credential lookup of the wrong size, or data too short for its
 * type.
 */
export function decodeWalletProgramAccount(data: Uint8Array): WalletProgramAccount | null {
  return decodeAccountRoot(data, (bytes) => WalletProgramAccount.from_array(bytes));
}

/**
 * Decodes a wallet account: the account type must be wallet and the data must
 * hold the header and every authority record. Returns null otherwise.
 */
export function decodeWalletAccount(data: Uint8Array): WalletAccount | null {
  const payload = decodeWalletProgramAccount(data)?.payload();
  const wallet = payload?.asWalletV1();
  if (!payload || !wallet) return null;
  /* The program accepts trailing bytes after the last authority record. */
  if (!WalletAccount.validate(payload.bytes()).ok) return null;
  return wallet;
}

/**
 * Parse wallet account data to extract nonce. Throws when the data is not a
 * wallet account.
 */
export function parseWalletNonce(data: Uint8Array): bigint {
  const account = decodeWalletAccount(data);
  if (!account) throw new Error('Account data is not a wallet account');
  return account.get_nonce();
}

/**
 * Fetch wallet nonce from the chain. A wallet that does not exist yet (no
 * data) has nonce 0.
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
  /** The wallet layout: only the discriminated (wallet_v1) layout decodes. */
  layout: 'authorityRecord';
}

/**
 * Parse the on-chain WalletAccount data buffer into its nonce and full
 * authority list using the generated ABI view.
 */
export function parseWalletAuthorities(data: Uint8Array): WalletAuthorities {
  const account = decodeWalletAccount(data);
  if (!account) throw new Error('Account data is not a wallet account');

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

/**
 * Encode a 32-byte pubkey to its base58 wallet address representation.
 */
export function formatAuthorityPubkey(pubkey: Uint8Array): string {
  return encodeAddress(pubkey);
}

/**
 * Parse a credential lookup account and return the wallet account pubkey
 * stored inside it, or null when the data is not a credential lookup.
 */
export function parseCredentialLookupWallet(data: Uint8Array): Uint8Array | null {
  const lookup = decodeWalletProgramAccount(data)?.payload().asCredentialLookupV1();
  if (!lookup) return null;
  return Uint8Array.from(lookup.get_wallet().get_bytes());
}
