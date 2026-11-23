/**
 * Opt-in integration test against the real Thru device app on Speculos,
 * through the DMK Speculos transport. Skipped unless `SPECULOS_URL` is set.
 *
 *   speculos --model nanosp --seed "abandon abandon … about" app-thru.elf
 *   SPECULOS_URL=http://127.0.0.1:5000 pnpm --filter @thru/ledger test:speculos
 *
 * Environment:
 * - `SPECULOS_URL`: Speculos REST API (required to run).
 * - `SPECULOS_MNEMONIC`: the seed Speculos was started with. Defaults to the
 *   corpus seed (`abandon … about`); corpus signatures are compared only
 *   for that seed.
 * - `SPECULOS_AUTOMATION`: `nano` (default) uses the repository's Python 3
 *   `ledger/sim` screen driver; `none` leaves navigation to a human or an
 *   external harness. Touch devices need `none` plus an external harness.
 *
 * Blind signing must be enabled in the app settings for the SIGN_TXN cases;
 * if it is off they assert `BlindSigningDisabledError` instead.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { type DeviceManagementKit } from '@ledgerhq/device-management-kit';
import { TransactionSigningScheme } from '@thru/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BlindSigningDisabledError } from '../errors';
import { ThruLedgerSigner } from '../ThruLedgerSigner';
import { fromHex, toHex } from '../protocol';
import { connectSpeculos, createSpeculosDmk } from '../transports/speculos';
import { eoaVectors, messageVectors, txnVectors } from './helpers/corpus';
import { KEY0, loadHdVectors } from './helpers/fixtures';

const URL = process.env.SPECULOS_URL;
const MNEMONIC = process.env.SPECULOS_MNEMONIC ?? KEY0.mnemonic;
const AUTOMATION = process.env.SPECULOS_AUTOMATION ?? 'nano';
const CORPUS_SEED = MNEMONIC === KEY0.mnemonic;
const PATH0 = "m/44'/8478'/0'/0'";

/** Reuse the owning simulator driver, including title/approval disambiguation. */
async function startAutoApprove(base: string): Promise<ChildProcess> {
  const driver = fileURLToPath(new globalThis.URL('../../../../../ledger/sim/driver/speculos_driver.py', import.meta.url));
  const child = spawn('python3', [driver, '--api', base, '--model', 'nanosp', 'auto-approve', '--kind', 'auto'], {
    stdio: 'inherit',
  });
  await once(child, 'spawn');
  return child;
}

describe.skipIf(URL === undefined)('Speculos: real Thru app', () => {
  let dmk: DeviceManagementKit;
  let sessionId: string;
  let signer: ThruLedgerSigner;
  let approver: ChildProcess | undefined;
  let blindSigning = false;
  const expected = loadHdVectors().derivations.find((d) => d.mnemonic === MNEMONIC && d.path === PATH0 && d.passphrase === '');

  beforeAll(async () => {
    dmk = createSpeculosDmk({ url: URL });
    sessionId = await connectSpeculos(dmk, { timeoutMs: 10_000 });
    signer = new ThruLedgerSigner({
      dmk,
      sessionId,
      skipOpenApp: true,
      transactionSigningScheme: TransactionSigningScheme.Rfc8032,
    });
    if (AUTOMATION === 'nano') approver = await startAutoApprove(URL as string);
    blindSigning = (await signer.getAppConfig()).blindSigningEnabled;
  }, 60_000);

  afterAll(async () => {
    if (approver && approver.exitCode === null && approver.signalCode === null) {
      const exited = once(approver, 'exit');
      approver.kill();
      await exited;
    }
    dmk?.close();
  });

  it('reports APDU protocol version 1', async () => {
    expect((await signer.getAppConfig()).apduProtocolVersion).toBe(1);
  });

  it('derives the SLIP-10 key for the corpus path', async () => {
    const { publicKey, address } = await signer.getAddress(PATH0);
    if (expected !== undefined) {
      expect(toHex(publicKey)).toBe(expected.pubkey_hex);
      expect(address).toBe(expected.address);
    }
  });

  it('enforces the path policy on the device itself (raw APDUs)', async () => {
    const send = async (hex: string): Promise<string> => {
      const r = await dmk.sendApdu({ sessionId, apdu: fromHex(hex) });
      return toHex(r.statusCode);
    };
    expect(await send('E006000011048000002C800001F58000000080000000')).toBe('6820');
    expect(await send('E006000011048000002C8000270F8000000080000000')).toBe('6820');
    expect(await send('E006000011048000002C8000211E8000000080000001')).toBe('6820');
    expect(await send('E006020011048000002C8000211E8000000080000000')).toBe('6a86');
    expect(await send('E00700001104800000')).not.toBe('9000');
  });

  it('shows and confirms the address', async () => {
    await expect(signer.getAddress(PATH0, { display: true })).resolves.toBeDefined();
  }, 60_000);

  it('signs ledger_txn_minimal', async () => {
    const v = txnVectors().find((t) => t.name === 'ledger_txn_minimal')!;
    const pending = signer.signTransactionBody(PATH0, fromHex(v.body_hex));
    if (!blindSigning) {
      await expect(pending).rejects.toBeInstanceOf(BlindSigningDisabledError);
      return;
    }
    const out = await pending;
    if (CORPUS_SEED) expect(toHex(out.signature)).toBe(v.signature_hex);
  }, 120_000);

  it('signs ledger_txn_max_mtu (129 chunks) and reports timing', async () => {
    const v = txnVectors().find((t) => t.name === 'ledger_txn_max_mtu')!;
    if (!blindSigning) return;
    const started = Date.now();
    const out = await signer.signTransactionBody(PATH0, fromHex(v.body_hex));
    console.info(`ledger_txn_max_mtu: ${Date.now() - started} ms from first APDU to signature`);
    if (CORPUS_SEED) expect(toHex(out.signature)).toBe(v.signature_hex);
  }, 300_000);

  it('signs ledger_msg_hello (two passes)', async () => {
    const v = messageVectors().find((m) => m.name === 'ledger_msg_hello')!;
    const out = await signer.signMessage(PATH0, fromHex(v.message_hex));
    if (CORPUS_SEED) expect(toHex(out.signature)).toBe(v.signature_hex);
  }, 120_000);

  it('signs ledger_eoa_create_chain_1', async () => {
    const v = eoaVectors().find((e) => e.name === 'ledger_eoa_create_chain_1')!;
    if (!CORPUS_SEED) return;
    const out = await signer.signEoaAuth(PATH0, 'create', v.chain_id, fromHex(v.fee_payer_hex), fromHex(v.account_hex));
    expect(toHex(out.signature)).toBe(v.signature_hex);
  }, 120_000);
});

