/**
 * `@thru/ledger/node-hid`: USB HID from Node.js (scripts, CLIs, local tests).
 *
 * Uses `@ledgerhq/device-transport-kit-node-hid`, which pulls in the native
 * `node-hid` and `usb` modules. It is **not** a dependency of this package:
 * install it yourself (`pnpm add @ledgerhq/device-transport-kit-node-hid`).
 * It is loaded with a dynamic import so browser bundles and this workspace
 * never need the native modules.
 */
import {
  type DeviceManagementKit,
  DeviceManagementKitBuilder,
  type DeviceSessionId,
  type TransportFactory,
  type TransportIdentifier,
} from '@ledgerhq/device-management-kit';

import { connectLedger, type ConnectLedgerOptions } from '../connect';
import { TransportError } from '../errors';

const NODE_HID_KIT = '@ledgerhq/device-transport-kit-node-hid';

interface NodeHidKit {
  nodeHidTransportFactory: TransportFactory;
  nodeHidIdentifier: TransportIdentifier;
}

async function loadKit(): Promise<NodeHidKit> {
  try {
    return (await import(/* @vite-ignore */ NODE_HID_KIT)) as NodeHidKit;
  } catch (e) {
    throw new TransportError(`${NODE_HID_KIT} is not installed; add it to use Node HID`, { cause: e });
  }
}

/** A DMK instance with only the Node HID transport. */
export async function createNodeHidDmk(): Promise<DeviceManagementKit> {
  const kit = await loadKit();
  return new DeviceManagementKitBuilder().addTransport(kit.nodeHidTransportFactory).build();
}

export async function connectNodeHid(
  dmk: DeviceManagementKit,
  options: Omit<ConnectLedgerOptions, 'transport'> = {},
): Promise<DeviceSessionId> {
  const kit = await loadKit();
  return connectLedger(dmk, { ...options, transport: kit.nodeHidIdentifier });
}
