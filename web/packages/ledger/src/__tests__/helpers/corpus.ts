/** Typed access to the shared signing corpus (`contrib/test/vectors/signing`). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CORPUS_DIR } from './fixtures';

export type Category = 'valid' | 'reject' | 'device_reject';

export interface TxnVector {
  name: string;
  category: Category;
  reject_reason: string | null;
  sw_class: string | null;
  sw: string | null;
  body_len: number;
  body_hex: string;
  body_sha256_hex: string;
  signer_path: string;
  signer_seed_hex: string;
  signer_pubkey_hex: string;
  signer_addr: string;
  signing_message_hex: string | null;
  signature_hex: string | null;
  wire_hex: string | null;
  envelope: {
    version: number;
    flags: number;
    chain_id: number;
    cu: number;
    su: number;
    mu: number;
    pad: number;
    expiry_after: number;
    rw_cnt: number;
    ro_cnt: number;
    instr_sz: number;
    fee: string;
    nonce: string;
    start_slot: string;
    expiry_slot: string;
    fee_payer_addr: string;
    program_addr: string;
    proof_type: 'existing' | 'creation' | null;
  } | null;
  /** The transfer the device reviews in clear, or `null` for the blind-signing review (corpus README). */
  clear_transfer: ClearTransferLabel | null;
}

/** Corpus `clear_transfer` label, written by the generator at construction. */
export interface ClearTransferLabel {
  kind: 'native' | 'token' | 'token_checked' | 'wallet';
  source_hex: string;
  recipient_hex: string;
  /** Decimal u64. */
  amount: string;
  mint_hex?: string;
  decimals?: number;
  ticker?: string;
  authority_index?: number;
}

export interface MessageVector {
  name: string;
  category: Category;
  reject_reason: string | null;
  sw: string | null;
  message_len: number;
  message_hex: string;
  message_sha256_hex: string;
  is_printable_ascii: boolean;
  display: 'text' | 'hash';
  signer_path: string;
  signer_seed_hex: string;
  signer_pubkey_hex: string;
  signing_message_hex: string | null;
  signature_hex: string | null;
}

export interface EoaVector {
  name: string;
  category: Category;
  reject_reason: string | null;
  sw: string | null;
  kind: 'create' | 'delete';
  chain_id: number;
  fee_payer_hex: string;
  account_hex: string;
  signer_path: string;
  signer_seed_hex: string;
  signer_pubkey_hex: string;
  auth_message_hex: string;
  signature_hex: string | null;
}

function load<T>(file: string): T[] {
  return JSON.parse(readFileSync(join(CORPUS_DIR, file), 'utf8')) as T[];
}

export const txnVectors = (): TxnVector[] => load<TxnVector>('txn_vectors.json');
export const messageVectors = (): MessageVector[] => load<MessageVector>('message_vectors.json');
export const eoaVectors = (): EoaVector[] => load<EoaVector>('eoa_auth_vectors.json');

export const swNumber = (sw: string | null): number | null => (sw === null ? null : parseInt(sw, 16));
