/**
 * The `@thru/ledger/speculos` entry over real HTTP: a minimal fake of the
 * Speculos REST API (`POST /apdu`, `GET /events`) backed by the mock device.
 * This checks the DMK Speculos transport wiring in CI without the real app;
 * `speculos.integration.test.ts` runs the same flows against the real app.
 */
import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';

import { type DeviceManagementKit } from '@ledgerhq/device-management-kit';
import { TransactionSigningScheme } from '@thru/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ThruLedgerSigner } from '../ThruLedgerSigner';
import { fromHex, toHex } from '../protocol';
import { connectSpeculos, createSpeculosDmk } from '../transports/speculos';
import { messageVectors, txnVectors } from './helpers/corpus';
import { KEY0 } from './helpers/fixtures';
import { MockThruDevice } from './helpers/mock-device';

const PATH0 = "m/44'/8478'/0'/0'";

describe('Speculos transport (fake Speculos HTTP server)', () => {
  const device = new MockThruDevice();
  let server: Server;
  let dmk: DeviceManagementKit;
  let signer: ThruLedgerSigner;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.method === 'GET' && req.url?.startsWith('/events')) {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"events":[]}');
        return;
      }
      if (req.method === 'POST' && req.url === '/apdu') {
        let raw = '';
        req.on('data', (c: Buffer) => (raw += c.toString()));
        req.on('end', () => {
          const { data } = JSON.parse(raw) as { data: string };
          void device.exchange(fromHex(data)).then((reply) => {
            const sw = new Uint8Array([reply.sw >> 8, reply.sw & 0xff]);
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ data: toHex(reply.data) + toHex(sw) }));
          });
        });
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    dmk = createSpeculosDmk({ url: `http://127.0.0.1:${port}` });
    const sessionId = await connectSpeculos(dmk, { timeoutMs: 5000 });
    signer = new ThruLedgerSigner({
      dmk,
      sessionId,
      skipOpenApp: true,
      transactionSigningScheme: TransactionSigningScheme.Rfc8032,
    });
  });

  afterAll(async () => {
    dmk?.close();
    await new Promise((r) => server.close(r));
  });

  it('derives the address', async () => {
    const { address } = await signer.getAddress(PATH0);
    expect(address).toBe(KEY0.address);
  });

  it('signs ledger_txn_minimal and ledger_msg_hello with the corpus signatures', async () => {
    const t = txnVectors().find((v) => v.name === 'ledger_txn_minimal')!;
    const m = messageVectors().find((v) => v.name === 'ledger_msg_hello')!;
    expect(toHex((await signer.signTransactionBody(PATH0, fromHex(t.body_hex))).signature)).toBe(t.signature_hex);
    expect(toHex((await signer.signMessage(PATH0, fromHex(m.message_hex))).signature)).toBe(m.signature_hex);
  });
});
