export const THRU_POLYGON_CHAIN_IDS = {
  thru: 1,
  polygon: 2,
} as const;

export const THRU_TOKEN_PROGRAM_ADDRESS = 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKqq';

export const THRU_STATE_PROOF_WIRE_TYPES = {
  existing: 0,
  updating: 1,
  creating: 2,
} as const;

export const POLYGON_BRIDGE_ABI = [
  'function deposit(address token, uint256 amount, bytes32 recipient) external',
  'event Deposit(uint256 indexed sequence, uint16 sourceChainId, uint16 destChainId, address token, address depositor, bytes32 recipient, uint256 amount, string tokenName, string tokenSymbol, uint8 tokenDecimals)',
] as const;

export const POLYGON_ERC20_ABI = [
  'function decimals() external view returns (uint8)',
  'function name() external view returns (string)',
  'function symbol() external view returns (string)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
] as const;
