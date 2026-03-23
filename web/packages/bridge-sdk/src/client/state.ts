import { createThruClient } from '@thru/thru-sdk/client';
import type { Thru } from '@thru/thru-sdk/client';
import { Contract, Interface, JsonRpcProvider, Wallet } from 'ethers';
import type { Provider, Signer } from 'ethers';
import { POLYGON_BRIDGE_ABI, THRU_TOKEN_PROGRAM_ADDRESS } from '../constants';
import type { BridgeClientConfig, PolygonSignerConfig } from '../types';
import {
  isPolygonPrivateKeySignerConfig,
  parseThruPrivateKey,
  validateAddress,
  validateThruAddress,
} from '../utils';

type PolygonConfigState = {
  provider: Provider;
  signer: Signer;
  bridgeAddress: string;
  bridgeContract: Contract;
  bridgeIface: Interface;
};

export type ThruConfigState = {
  client: Thru;
  bridgeProgramAddress: string;
  tokenProgramAddress: string;
  feePayerAddress: string;
  feePayerPrivateKey: Uint8Array;
};

export type BridgeClientState = {
  polygon: PolygonConfigState | null;
  thru: ThruConfigState | null;
};

export function buildBridgeClientState(config: BridgeClientConfig): BridgeClientState {
  if (!config.polygon && !config.thru) {
    throw new Error('At least one of polygon or thru config must be provided');
  }

  const polygon = config.polygon ? buildPolygonState(config.polygon) : null;
  const thru = config.thru ? buildThruState(config.thru) : null;

  return { polygon, thru };
}

export function requirePolygon(state: BridgeClientState): PolygonConfigState {
  if (!state.polygon) {
    throw new Error('Polygon config is required for this operation');
  }
  return state.polygon;
}

export function requireThru(state: BridgeClientState): ThruConfigState {
  if (!state.thru) {
    throw new Error('Thru config is required for this operation');
  }
  return state.thru;
}

function buildPolygonState(config: NonNullable<BridgeClientConfig['polygon']>): PolygonConfigState {
  const bridgeAddress = validateAddress(config.polygonBridgeAddress, 'polygon.polygonBridgeAddress');
  const { signer, provider } = buildSignerAndProvider(config.signer);
  return {
    provider,
    signer,
    bridgeAddress,
    bridgeContract: new Contract(bridgeAddress, POLYGON_BRIDGE_ABI, signer),
    bridgeIface: new Interface(POLYGON_BRIDGE_ABI),
  };
}

function buildThruState(config: NonNullable<BridgeClientConfig['thru']>): ThruConfigState {
  const bridgeProgramAddress = validateThruAddress(config.thruBridgeProgramAddress, 'thru.thruBridgeProgramAddress');
  const feePayerAddress = validateThruAddress(config.signer.feePayerAddress, 'thru.signer.feePayerAddress');
  const feePayerPrivateKey = parseThruPrivateKey(config.signer.feePayerPrivateKey, 'thru.signer.feePayerPrivateKey');

  return {
    client: createThruClient({ baseUrl: config.signer.baseUrl }),
    bridgeProgramAddress,
    tokenProgramAddress: THRU_TOKEN_PROGRAM_ADDRESS,
    feePayerAddress,
    feePayerPrivateKey,
  };
}

function buildSignerAndProvider(config: PolygonSignerConfig): { signer: Signer; provider: Provider } {
  if (isPolygonPrivateKeySignerConfig(config)) {
    const provider = new JsonRpcProvider(config.rpcUrl);
    const signer = new Wallet(config.privateKey, provider);
    return { signer, provider };
  }

  const signer = config.signer;
  if (signer.provider) {
    return { signer, provider: signer.provider };
  }

  if (!config.rpcUrl) {
    throw new Error(
      'polygon.signer.provider is undefined. Provide a signer connected to a provider or set polygon.signer.rpcUrl'
    );
  }

  const provider = new JsonRpcProvider(config.rpcUrl);
  const connectedSigner = signer.connect(provider);
  return { signer: connectedSigner, provider };
}
