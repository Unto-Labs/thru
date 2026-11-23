/** Discovery and connection helpers shared by the transport entry points. */
import {
  type DeviceManagementKit,
  type DeviceSessionId,
  type TransportIdentifier,
} from '@ledgerhq/device-management-kit';
import { firstValueFrom, timeout } from 'rxjs';

import { toThruLedgerError } from './dmk/to-error';

export interface ConnectLedgerOptions {
  /** Restrict discovery to one transport (for example `"WEB-HID"`). */
  transport?: TransportIdentifier;
  /** Give up if no device is discovered in time. Default 30 s. */
  timeoutMs?: number;
}

/**
 * Discover the first Ledger device and open a DMK session to it.
 * With WebHID this opens the browser's device picker, so call it from a user
 * gesture (a click handler).
 */
export async function connectLedger(
  dmk: DeviceManagementKit,
  options: ConnectLedgerOptions = {},
): Promise<DeviceSessionId> {
  try {
    const device = await firstValueFrom(
      dmk.startDiscovering({ transport: options.transport }).pipe(timeout(options.timeoutMs ?? 30_000)),
    );
    return await dmk.connect({ device });
  } catch (e) {
    throw toThruLedgerError(e);
  } finally {
    try {
      await dmk.stopDiscovering();
    } catch {
      /* best effort */
    }
  }
}
