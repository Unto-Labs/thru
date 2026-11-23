/**
 * `@thru/ledger/webhid`: browser WebHID transport (Chrome/Edge desktop).
 * Requires the optional peer `@ledgerhq/device-transport-kit-web-hid`.
 *
 * WebHID needs a top-level browsing context (or `Permissions-Policy: hid`
 * delegation) and a user gesture for the device picker.
 */
import { type DeviceManagementKit, DeviceManagementKitBuilder, type DeviceSessionId } from '@ledgerhq/device-management-kit';
import { webHidIdentifier, webHidTransportFactory } from '@ledgerhq/device-transport-kit-web-hid';

import { connectLedger, type ConnectLedgerOptions } from '../connect';

export { webHidIdentifier, webHidTransportFactory };

/** A DMK instance with only the WebHID transport. */
export function createWebHidDmk(): DeviceManagementKit {
  return new DeviceManagementKitBuilder().addTransport(webHidTransportFactory).build();
}

/** Open the WebHID device picker and connect. Call from a user gesture. */
export function connectWebHid(dmk: DeviceManagementKit, options: Omit<ConnectLedgerOptions, 'transport'> = {}): Promise<DeviceSessionId> {
  return connectLedger(dmk, { ...options, transport: webHidIdentifier });
}
