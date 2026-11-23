/**
 * `@thru/ledger/speculos`: the DMK Speculos (emulator) transport, for tests
 * and CI. Requires the optional peer `@ledgerhq/device-transport-kit-speculos`.
 */
import {
  type DeviceManagementKit,
  DeviceManagementKitBuilder,
  type DeviceModelId,
  type DeviceSessionId,
} from '@ledgerhq/device-management-kit';
import { speculosIdentifier, speculosTransportFactory } from '@ledgerhq/device-transport-kit-speculos';

import { connectLedger, type ConnectLedgerOptions } from '../connect';

export { speculosIdentifier, speculosTransportFactory };

export interface SpeculosDmkOptions {
  /** Speculos REST API, default `http://127.0.0.1:5000`. */
  url?: string;
  deviceModelId?: DeviceModelId;
  /**
   * DMK's E2E mode: disables the transport's 2 s server-liveness polling,
   * which otherwise keeps a timer alive in test runners.
   */
  e2e?: boolean;
}

/** A DMK instance with only the Speculos transport. */
export function createSpeculosDmk(options: SpeculosDmkOptions = {}): DeviceManagementKit {
  return new DeviceManagementKitBuilder()
    .addTransport(speculosTransportFactory(options.url ?? 'http://127.0.0.1:5000', options.e2e ?? true, options.deviceModelId))
    .build();
}

export function connectSpeculos(dmk: DeviceManagementKit, options: Omit<ConnectLedgerOptions, 'transport'> = {}): Promise<DeviceSessionId> {
  return connectLedger(dmk, { ...options, transport: speculosIdentifier });
}
