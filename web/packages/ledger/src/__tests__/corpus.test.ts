/**
 * Conformance against the shared signing corpus (`contrib/test/vectors/signing`,
 * consumer contract in its README). These are mandatory: a missing corpus file
 * fails the suite. Device-side behavior (signatures produced through the APDU
 * flow) is covered in `mock-device.test.ts`.
 */
import { buildTransactionSigningMessage, eoa, verifyMessage, verifyWithDomain, SignatureDomain } from '@thru/sdk';
import { encodeAddress } from '@thru/sdk/helpers';
import { describe, expect, it } from 'vitest';

import {
  APDU_MAX_DATA,
  computeBodyHashDisplay,
  computeMessageHashDisplay,
  type ClearTransfer,
  decodeClearTransfer,
  describeTransaction,
  fromHex,
  isDisplayablePrintable,
  messageDisplayMode,
  parseLedgerPath,
  parseTransactionBody,
  signTxnApdus,
  toHex,
} from '../protocol';
import { type ClearTransferLabel, eoaVectors, messageVectors, swNumber, txnVectors } from './helpers/corpus';
import { streamed } from './helpers/stream';

const txns = txnVectors();
const msgs = messageVectors();
const eoas = eoaVectors();

describe('corpus presence', () => {
  it('has the named worked-example vectors', () => {
    expect(txns.map((v) => v.name)).toContain('ledger_txn_minimal');
    expect(txns.map((v) => v.name)).toContain('ledger_txn_max_mtu');
    expect(msgs.map((v) => v.name)).toContain('ledger_msg_hello');
    expect(eoas.map((v) => v.name)).toContain('ledger_eoa_create_chain_1');
  });
});

/** The corpus label of a decoded transfer (corpus README, `clear_transfer`). */
function clearTransferLabel(t: ClearTransfer): ClearTransferLabel {
  const label: ClearTransferLabel = {
    kind: t.checked !== null ? 'token_checked' : t.kind,
    source_hex: toHex(t.source),
    recipient_hex: toHex(t.recipient),
    amount: t.amount.toString(),
  };
  if (t.checked !== null) {
    label.mint_hex = toHex(t.checked.mint);
    label.decimals = t.checked.decimals;
    label.ticker = t.checked.ticker;
  }
  if (t.authorityIndex !== null) label.authority_index = t.authorityIndex;
  return label;
}

describe('txn_vectors: device-equivalent verdicts', () => {
  it.each(txns.map((v) => [v.name, v] as const))('%s', (_name, v) => {
    const body = fromHex(v.body_hex);
    const pubkey = fromHex(v.signer_pubkey_hex);
    expect(body.length).toBe(v.body_len);
    expect(computeBodyHashDisplay(body)).toBe(v.body_sha256_hex);
    parseLedgerPath(v.signer_path);

    const r = parseTransactionBody(body, pubkey);
    if (v.category === 'valid') {
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(toHex(r.bodyHash)).toBe(v.body_sha256_hex);
      const e = v.envelope!;
      const h = r.header;
      expect([h.version, h.flags, h.chainId, h.computeUnits, h.stateUnits, h.memoryUnits, h.pad]).toEqual([
        e.version, e.flags, e.chain_id, e.cu, e.su, e.mu, e.pad,
      ]);
      expect([h.expiryAfter, h.rwCnt, h.roCnt, h.instrSz]).toEqual([e.expiry_after, e.rw_cnt, e.ro_cnt, e.instr_sz]);
      expect([h.fee.toString(), h.nonce.toString(), h.startSlot.toString()]).toEqual([e.fee, e.nonce, e.start_slot]);
      expect(encodeAddress(h.feePayer)).toBe(e.fee_payer_addr);
      expect(encodeAddress(h.program)).toBe(e.program_addr);
      expect(r.proofType === null ? null : r.proofType === 0 ? 'existing' : 'creation').toBe(e.proof_type);
      const review = describeTransaction(body, pubkey);
      /* The device clear-signs exactly the labelled corpus bodies (app-thru
         test_sign_txn.py CLEAR_CORPUS); all others need blind signing. */
      expect(review.requiresBlindSigning).toBe(v.clear_transfer === null);
      const expiry = BigInt(e.expiry_slot);
      expect(review.fields.find((f) => f.label === 'Valid slots')?.value).toBe(
        expiry > BigInt(e.start_slot) ? `${e.start_slot} to ${expiry - 1n}` : 'none',
      );
      /* M and the APDU plan. */
      expect(toHex(buildTransactionSigningMessage(body).m)).toBe(v.signing_message_hex);
      const apdus = signTxnApdus(v.signer_path, body);
      expect(apdus.length - 1).toBe(Math.ceil(body.length / APDU_MAX_DATA));
    } else {
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.sw).toBe(swNumber(v.sw));
    }
  });

  it('decodeClearTransfer gives every valid vector its corpus clear_transfer label', () => {
    const counts = { clear: 0, checked: 0, blind: 0 };
    for (const v of txns) {
      if (v.category !== 'valid') {
        expect(v.clear_transfer, v.name).toBeNull();
        continue;
      }
      const t = decodeClearTransfer(fromHex(v.body_hex));
      expect(t === null ? null : clearTransferLabel(t), v.name).toEqual(v.clear_transfer);
      counts[t === null ? 'blind' : t.checked !== null ? 'checked' : 'clear'] += 1;
    }
    expect(counts.clear).toBeGreaterThanOrEqual(2);
    expect(counts.checked).toBeGreaterThanOrEqual(5);
    expect(counts.blind).toBeGreaterThanOrEqual(14);
  });

  it('ledger_txn_max_mtu streams in 129 data chunks', () => {
    const v = txns.find((t) => t.name === 'ledger_txn_max_mtu')!;
    expect(signTxnApdus(v.signer_path, fromHex(v.body_hex))).toHaveLength(130);
  });

  it('verdicts are chunking-invariant across the corpus', () => {
    for (const v of txns) {
      const body = fromHex(v.body_hex);
      const pubkey = fromHex(v.signer_pubkey_hex);
      for (const size of [1, 7, 32, 113, 255]) {
        const r = streamed(body, size, pubkey);
        expect(r.ok, `${v.name} @${size}`).toBe(v.category === 'valid');
        if (!r.ok) expect(r.sw, `${v.name} @${size}`).toBe(swNumber(v.sw));
      }
    }
  });

  it('valid signatures verify strictly and attach to wire_hex', async () => {
    for (const v of txns.filter((t) => t.signature_hex !== null)) {
      const msg = buildTransactionSigningMessage(fromHex(v.body_hex));
      const wire = await msg.attach(fromHex(v.signature_hex!));
      expect(toHex(wire), v.name).toBe(v.wire_hex);
    }
  });
});

describe('message_vectors', () => {
  it.each(msgs.map((v) => [v.name, v] as const))('%s', async (_name, v) => {
    const m = fromHex(v.message_hex);
    expect(m.length).toBe(v.message_len);
    expect(computeMessageHashDisplay(m)).toBe(v.message_sha256_hex);
    expect(isDisplayablePrintable(m)).toBe(v.is_printable_ascii);
    if (v.message_len <= 32768) expect(messageDisplayMode(m)).toBe(v.display);
    if (v.signature_hex !== null && v.category === 'valid') {
      expect(await verifyMessage(fromHex(v.signature_hex), m, fromHex(v.signer_pubkey_hex))).toBe(true);
    }
  });
});

describe('eoa_auth_vectors', () => {
  it.each(eoas.map((v) => [v.name, v] as const))('%s', async (_name, v) => {
    const feePayer = fromHex(v.fee_payer_hex);
    const account = fromHex(v.account_hex);
    const build = v.kind === 'create' ? eoa.buildEOACreateMessage : eoa.buildEOADeleteMessage;
    expect(toHex(build(v.chain_id, feePayer, account))).toBe(v.auth_message_hex);
    if (v.category === 'valid') {
      const domain = v.kind === 'create' ? SignatureDomain.EOA_CREATE : SignatureDomain.EOA_DELETE;
      const ok = await verifyWithDomain(
        fromHex(v.signature_hex!),
        fromHex(v.auth_message_hex).subarray(16),
        account,
        domain,
      );
      expect(ok).toBe(true);
    }
  });
});
