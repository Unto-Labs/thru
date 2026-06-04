import {
  approvePolygonToken as approvePolygonTokenImpl,
  depositPolygonToThru as depositPolygonToThruImpl,
  getPolygonDepositFromTx as getPolygonDepositFromTxImpl,
  getPolygonTokenMetadata as getPolygonTokenMetadataImpl,
} from './client/polygonToThru';
import { buildBridgeClientState, type BridgeClientState } from './client/state';
import {
  depositThruToPolygon as depositThruToPolygonImpl,
  getThruPolygonTokenRoute as getThruPolygonTokenRouteImpl,
} from './client/thruToPolygon';
import type {
  BridgeClientConfig,
  PolygonDepositEvent,
  PolygonTokenApprovalRequest,
  PolygonTokenApprovalResult,
  PolygonTokenMetadata,
  PolygonToThruDepositRequest,
  PolygonToThruDepositResult,
  ThruPolygonTokenRoute,
  ThruToPolygonDepositRequest,
  ThruToPolygonDepositResult,
} from './types';

export class BridgeClient {
  private readonly state: BridgeClientState;

  constructor(config: BridgeClientConfig) {
    this.state = buildBridgeClientState(config);
  }

  async getPolygonTokenMetadata(polygonTokenAddress: string): Promise<PolygonTokenMetadata> {
    return getPolygonTokenMetadataImpl(this.state, polygonTokenAddress);
  }

  async approvePolygonToken(input: PolygonTokenApprovalRequest): Promise<PolygonTokenApprovalResult> {
    return approvePolygonTokenImpl(this.state, input);
  }

  async depositPolygonToThru(input: PolygonToThruDepositRequest): Promise<PolygonToThruDepositResult> {
    return depositPolygonToThruImpl(this.state, input);
  }

  async getPolygonDepositFromTx(txHash: string): Promise<PolygonDepositEvent | null> {
    return getPolygonDepositFromTxImpl(this.state, txHash);
  }

  async getThruPolygonTokenRoute(thruTokenMintAddress: string): Promise<ThruPolygonTokenRoute> {
    return getThruPolygonTokenRouteImpl(this.state, thruTokenMintAddress);
  }

  async depositThruToPolygon(input: ThruToPolygonDepositRequest): Promise<ThruToPolygonDepositResult> {
    return depositThruToPolygonImpl(this.state, input);
  }
}

export function createBridgeClient(config: BridgeClientConfig): BridgeClient {
  return new BridgeClient(config);
}
