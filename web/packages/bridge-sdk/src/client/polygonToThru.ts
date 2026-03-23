import { Pubkey } from '@thru/thru-sdk';
import { Contract, toBeHex } from 'ethers';
import type { EventLog, Interface, TransactionReceipt } from 'ethers';
import { assertU64Amount } from '../amount';
import { POLYGON_ERC20_ABI, THRU_POLYGON_CHAIN_IDS } from '../constants';
import type {
  DepositLogInput,
  PolygonDepositEvent,
  PolygonTokenApprovalRequest,
  PolygonTokenApprovalResult,
  PolygonTokenMetadata,
  PolygonToThruDepositRequest,
  PolygonToThruDepositResult,
} from '../types';
import { normalizeHex, validateAddress } from '../utils';
import { requirePolygon, type BridgeClientState } from './state';

type DepositArgs = {
  sequence: bigint;
  sourceChainId: number;
  destChainId: number;
  token: string;
  depositor: string;
  recipient: string;
  amount: bigint;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimals: bigint | number;
};

export async function getPolygonTokenMetadata(
  state: BridgeClientState,
  polygonTokenAddress: string
): Promise<PolygonTokenMetadata> {
  const { provider } = requirePolygon(state);
  const tokenAddress = validateAddress(polygonTokenAddress, 'polygonTokenAddress');
  const token = new Contract(tokenAddress, POLYGON_ERC20_ABI, provider);

  const [name, symbol, decimals] = await Promise.all([
    token.name() as Promise<string>,
    token.symbol() as Promise<string>,
    token.decimals() as Promise<number>,
  ]);

  return {
    address: tokenAddress,
    name,
    symbol,
    decimals: Number(decimals),
  };
}

export async function approvePolygonToken(
  state: BridgeClientState,
  input: PolygonTokenApprovalRequest
): Promise<PolygonTokenApprovalResult> {
  const { bridgeAddress, signer } = requirePolygon(state);
  const tokenAddress = validateAddress(input.polygonTokenAddress, 'polygonTokenAddress');
  const amountRaw = assertU64Amount(input.rawAmount, 'rawAmount');
  if (amountRaw === 0n) {
    throw new Error('amountRaw must be > 0');
  }

  const token = new Contract(tokenAddress, POLYGON_ERC20_ABI, signer);
  const tx = await token.approve(bridgeAddress, amountRaw);
  const receipt = await tx.wait();
  if (!receipt) {
    throw new Error('approve transaction did not return a receipt');
  }

  return {
    polygonTxHash: tx.hash,
    amountRaw,
    polygonReceipt: receipt,
  };
}

export async function depositPolygonToThru(
  state: BridgeClientState,
  input: PolygonToThruDepositRequest
): Promise<PolygonToThruDepositResult> {
  const { bridgeContract, bridgeAddress, bridgeIface } = requirePolygon(state);

  const thruRecipient = input.thruRecipient.trim();
  if (!thruRecipient) {
    throw new Error('thruRecipient is required');
  }
  if (!Pubkey.isThruFmt(thruRecipient)) {
    throw new Error('thruRecipient must be a valid Thru address (ta...)');
  }

  const tokenAddress = validateAddress(input.polygonTokenAddress, 'polygonTokenAddress');
  const thruRecipientBytes32 = `0x${Pubkey.from(thruRecipient).toHex()}`;
  const amountRaw = assertU64Amount(input.rawAmount, 'rawAmount');
  if (amountRaw === 0n) {
    throw new Error('amountRaw must be > 0');
  }

  await assertSufficientAllowance(state, tokenAddress, amountRaw);

  const tx = await bridgeContract.deposit(tokenAddress, amountRaw, thruRecipientBytes32);
  const receipt = await tx.wait();
  if (!receipt) {
    throw new Error('deposit transaction did not return a receipt');
  }

  const polygonDepositEvent = extractPolygonDepositFromReceipt(receipt, {
    bridgeAddressLower: bridgeAddress.toLowerCase(),
    bridgeIface,
  });

  return {
    polygonTxHash: tx.hash,
    amountRaw,
    thruRecipient,
    thruRecipientBytes32,
    polygonReceipt: receipt,
    polygonDepositEvent,
  };
}

export async function getPolygonDepositFromTx(
  state: BridgeClientState,
  txHash: string
): Promise<PolygonDepositEvent | null> {
  const { provider, bridgeAddress, bridgeIface } = requirePolygon(state);
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    return null;
  }

  return extractPolygonDepositFromReceipt(receipt, {
    bridgeAddressLower: bridgeAddress.toLowerCase(),
    bridgeIface,
  });
}

async function assertSufficientAllowance(
  state: BridgeClientState,
  polygonTokenAddress: string,
  amountRaw: bigint
): Promise<void> {
  const { provider, signer, bridgeAddress } = requirePolygon(state);
  const token = new Contract(polygonTokenAddress, POLYGON_ERC20_ABI, provider);
  const owner = await signer.getAddress();
  const allowance = (await token.allowance(owner, bridgeAddress)) as bigint;
  if (allowance < amountRaw) {
    throw new Error(
      `insufficient allowance: approve at least ${amountRaw.toString()} for bridge ${bridgeAddress} by calling approvePolygonToken(...) first`
    );
  }
}

function extractPolygonDepositFromReceipt(
  receipt: TransactionReceipt,
  input: {
    bridgeAddressLower: string;
    bridgeIface: Interface;
  }
): PolygonDepositEvent | null {
  for (const log of receipt.logs) {
    const parsed = parsePolygonDepositLog(log, input);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

function parsePolygonDepositLog(
  log: DepositLogInput | EventLog,
  input: {
    bridgeAddressLower: string;
    bridgeIface: Interface;
  }
): PolygonDepositEvent | null {
  if (log.address.toLowerCase() !== input.bridgeAddressLower) {
    return null;
  }

  let parsed: ReturnType<Interface['parseLog']>;
  try {
    parsed = input.bridgeIface.parseLog({ data: log.data, topics: [...log.topics] });
  } catch {
    return null;
  }

  if (!parsed || parsed.name !== 'Deposit') {
    return null;
  }

  const args = parsed.args as unknown as DepositArgs;
  const recipientBytes32 = toBeHex(args.recipient, 32);
  let thruRecipient: string | null = null;
  try {
    thruRecipient = Pubkey.from(recipientBytes32).toThruFmt();
  } catch {
    thruRecipient = null;
  }

  const sourceChainId = Number(args.sourceChainId);
  const destChainId = Number(args.destChainId);

  return {
    sequence: args.sequence,
    sourceChainId,
    destChainId,
    polygonTokenAddress: normalizeHex(args.token),
    polygonDepositorAddress: args.depositor,
    thruRecipientBytes32: recipientBytes32,
    thruRecipient,
    amountRaw: args.amount,
    polygonTokenName: args.tokenName,
    polygonTokenSymbol: args.tokenSymbol,
    polygonTokenDecimals: Number(args.tokenDecimals),
    polygonTxHash: log.transactionHash,
    polygonBlockNumber: Number(log.blockNumber),
    polygonLogIndex: Number(log.index),
    matchesConfiguredRoute:
      sourceChainId === THRU_POLYGON_CHAIN_IDS.polygon &&
      destChainId === THRU_POLYGON_CHAIN_IDS.thru,
  };
}
