export { createBridgeClient, BridgeClient } from './client';
export {
  POLYGON_BRIDGE_ABI,
  POLYGON_ERC20_ABI,
  THRU_POLYGON_CHAIN_IDS,
  THRU_STATE_PROOF_WIRE_TYPES,
  THRU_TOKEN_PROGRAM_ADDRESS,
} from './constants';

export type {
  BridgeClientConfig,
  PolygonDepositEvent,
  PolygonSignerConfig,
  PolygonTokenApprovalRequest,
  PolygonTokenApprovalResult,
  PolygonTokenMetadata,
  PolygonToThruDepositRequest,
  PolygonToThruDepositResult,
  ThruPolygonTokenRoute,
  ThruSignerConfig,
  ThruToPolygonDepositRequest,
  ThruToPolygonDepositResult,
} from './types';
