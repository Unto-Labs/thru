/**
 * The `@thru/ledger/node-hid` entry. The Node HID kit pulls in native modules
 * and is deliberately not installed in this workspace, so the "installed" case
 * is exercised with a mocked module.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const KIT = '@ledgerhq/device-transport-kit-node-hid';

describe('Node HID transport entry', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock(KIT);
    vi.doUnmock('../connect');
    vi.resetModules();
  });

  describe('kit not installed', () => {
    it('createNodeHidDmk rejects with a TransportError naming the package', async () => {
      const { createNodeHidDmk } = await import('../transports/node-hid');
      const { TransportError } = await import('../errors');
      const err = await createNodeHidDmk().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TransportError);
      expect((err as Error).message).toContain(KIT);
      expect((err as Error).message).toContain('not installed');
    });

    it('connectNodeHid rejects with a TransportError naming the package', async () => {
      const { connectNodeHid } = await import('../transports/node-hid');
      const { TransportError } = await import('../errors');
      const err = await connectNodeHid({} as never).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TransportError);
      expect((err as Error).message).toContain(KIT);
      expect((err as Error).message).toContain('not installed');
    });
  });

  describe('kit installed (mocked)', () => {
    it('connectNodeHid passes the kit transport identifier to connectLedger', async () => {
      const connectLedger = vi.fn().mockResolvedValue('session-1');
      vi.doMock('../connect', () => ({ connectLedger }));
      vi.doMock(KIT, () => ({ nodeHidTransportFactory: vi.fn(), nodeHidIdentifier: 'NODE_HID' }));
      const { connectNodeHid } = await import('../transports/node-hid');
      const dmk = {} as never;
      await expect(connectNodeHid(dmk, { timeoutMs: 5 })).resolves.toBe('session-1');
      expect(connectLedger).toHaveBeenCalledWith(dmk, { timeoutMs: 5, transport: 'NODE_HID' });
    });
  });
});
