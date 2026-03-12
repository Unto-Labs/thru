import { decodeAddress, encodeAddress } from '@thru/helpers';
import { StateProofType } from '@thru/proto';
import { AccountView, Pubkey } from '@thru/thru-sdk';
import { createThruClient } from '@thru/thru-sdk/client';
import type { Thru } from '@thru/thru-sdk/client';
import { Contract, Interface, JsonRpcProvider, Wallet, toBeHex } from 'ethers';
import type { EventLog, Provider, Signer, TransactionReceipt } from 'ethers';
import { assertU64Amount } from './amount';
import {
  POLYGON_BRIDGE_ABI,
  POLYGON_ERC20_ABI,
  THRU_POLYGON_CHAIN_IDS,
  THRU_TOKEN_PROGRAM_ADDRESS,
} from './constants';
import type {
  BridgeClientConfig,
  DepositLogInput,
  PolygonDepositEvent,
  PolygonSignerConfig,
  PolygonTokenApprovalRequest,
  PolygonTokenApprovalResult,
  PolygonTokenMetadata,
  PolygonToThruDepositRequest,
  PolygonToThruDepositResult,
  ThruPolygonTokenRoute,
  ThruToPolygonDepositRequest,
  ThruToPolygonDepositResult,
} from './types';
import {
  bytes32ToEvmAddress,
  bytesEqual,
  bytesToHex,
  concatBytes,
  evmAddressToBytes32,
  isPolygonPrivateKeySignerConfig,
  isThruAccountNotFoundError,
  isZeroBytes,
  normalizeHex,
  normalizeThruTransactionWire,
  parseHexPayload,
  parseThruPrivateKey,
  readThruTxnHeader,
  readU16LE,
  readU64LE,
  u16LE,
  u32LE,
  u64LE,
  validateAddress,
  validateThruAddress,
} from './utils';

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

type ThruConfigState = {
  client: Thru;
  bridgeProgramAddress: string;
  tokenProgramAddress: string;
  feePayerAddress: string;
  feePayerPrivateKey: Uint8Array;
};

type ThruMintMetadataRoute = ThruPolygonTokenRoute & {
  destinationTokenBytes: Uint8Array;
};

type ThruDepositInstructionInput = {
  bridgeManagerAddress: string;
  tokenProgramAddress: string;
  tokenAccountAddress: string;
  tokenMintAddress: string;
  metadataAccountAddress: string;
  depositorAddress: string;
  feeTokenAccountAddress: string;
  feeCollectorAddress: string;
  recipientBytes32: Uint8Array;
  amountRaw: bigint;
  feeTokenSeed: Uint8Array;
  payload: Uint8Array;
  feeTokenProof: Uint8Array;
  getAccountIndex: (address: string) => number;
};

type PreparedThruToPolygonDeposit = {
  thruTokenMintAddress: string;
  thruTokenAccountAddress?: string;
  polygonRecipientAddress: string;
  recipientBytes32: Uint8Array;
  rawAmount: bigint;
  payload: Uint8Array;
};

type ResolvedThruToPolygonDeposit = {
  route: ThruMintMetadataRoute;
  bridgeManagerAddress: string;
  feeCollectorAddress: string;
  depositorAddress: string;
  thruTokenAccountAddress: string;
  feeVaultTokenAccountAddress: string;
  feeTokenSeed: Uint8Array;
  feeTokenProof: Uint8Array;
  readWriteAccounts: string[];
  readOnlyAccounts: string[];
};

const BRIDGE_INSTR_DEPOSIT = 2;
const THRU_TXN_MTU = 32768;
const BRIDGE_HEADER_SIZE = 68;
const BRIDGE_RING_SLOT_COUNT = 256;
const BRIDGE_RING_SLOT_SIZE = 140;
const BRIDGE_ACCOUNT_BASE_SIZE = BRIDGE_HEADER_SIZE + BRIDGE_RING_SLOT_COUNT * BRIDGE_RING_SLOT_SIZE;
const BRIDGE_FEE_COLLECTOR_OFFSET = BRIDGE_ACCOUNT_BASE_SIZE + 4;
const BRIDGE_MINT_METADATA_SIZE = 34;
const THRU_TOKEN_ACCOUNT_AMOUNT_OFFSET = 64;
const THRU_TOKEN_ACCOUNT_MIN_SIZE = THRU_TOKEN_ACCOUNT_AMOUNT_OFFSET + 8;
const BRIDGE_MAX_PAYLOAD_SIZE = 1024;

export class BridgeClient {
  private readonly polygonProvider: Provider | null;
  private readonly polygonSigner: Signer | null;
  private readonly polygonBridgeAddress: string | null;
  private readonly polygonBridgeContract: Contract | null;
  private readonly polygonBridgeIface: Interface | null;
  private readonly thru: ThruConfigState | null;

  constructor(config: BridgeClientConfig) {
    if (!config.polygon && !config.thru) {
      throw new Error('At least one of polygon or thru config must be provided');
    }

    if (config.polygon) {
      this.polygonBridgeAddress = validateAddress(
        config.polygon.polygonBridgeAddress,
        'polygon.polygonBridgeAddress'
      );
      const { signer, provider } = this.buildSignerAndProvider(config.polygon.signer);
      this.polygonSigner = signer;
      this.polygonProvider = provider;
      this.polygonBridgeContract = new Contract(this.polygonBridgeAddress, POLYGON_BRIDGE_ABI, this.polygonSigner);
      this.polygonBridgeIface = new Interface(POLYGON_BRIDGE_ABI);
    } else {
      this.polygonBridgeAddress = null;
      this.polygonSigner = null;
      this.polygonProvider = null;
      this.polygonBridgeContract = null;
      this.polygonBridgeIface = null;
    }

    if (config.thru) {
      const thruBridgeProgramAddress = validateThruAddress(
        config.thru.thruBridgeProgramAddress,
        'thru.thruBridgeProgramAddress'
      );
      const feePayerAddress = validateThruAddress(config.thru.signer.feePayerAddress, 'thru.signer.feePayerAddress');
      const feePayerPrivateKey = parseThruPrivateKey(
        config.thru.signer.feePayerPrivateKey,
        'thru.signer.feePayerPrivateKey'
      );
      const thruClient = createThruClient({ baseUrl: config.thru.signer.baseUrl });

      this.thru = {
        client: thruClient,
        bridgeProgramAddress: thruBridgeProgramAddress,
        tokenProgramAddress: THRU_TOKEN_PROGRAM_ADDRESS,
        feePayerAddress,
        feePayerPrivateKey,
      };
    } else {
      this.thru = null;
    }
  }

  async getPolygonTokenMetadata(polygonTokenAddress: string): Promise<PolygonTokenMetadata> {
    const { provider } = this.requirePolygon();
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

  async approvePolygonToken(input: PolygonTokenApprovalRequest): Promise<PolygonTokenApprovalResult> {
    const { bridgeAddress, signer } = this.requirePolygon();
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

  async depositPolygonToThru(input: PolygonToThruDepositRequest): Promise<PolygonToThruDepositResult> {
    const { bridgeContract } = this.requirePolygon();
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
    await this.assertSufficientAllowance(tokenAddress, amountRaw);

    const tx = await bridgeContract.deposit(tokenAddress, amountRaw, thruRecipientBytes32);
    const receipt = await tx.wait();
    if (!receipt) {
      throw new Error('deposit transaction did not return a receipt');
    }

    const polygonDepositEvent = this.extractPolygonDepositFromReceipt(receipt);
    return {
      polygonTxHash: tx.hash,
      amountRaw,
      thruRecipient,
      thruRecipientBytes32,
      polygonReceipt: receipt,
      polygonDepositEvent,
    };
  }

  async getPolygonDepositFromTx(txHash: string): Promise<PolygonDepositEvent | null> {
    const { provider } = this.requirePolygon();
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) return null;
    return this.extractPolygonDepositFromReceipt(receipt);
  }

  async getThruPolygonTokenRoute(thruTokenMintAddress: string): Promise<ThruPolygonTokenRoute> {
    const tokenMintAddress = validateThruAddress(thruTokenMintAddress, 'thruTokenMintAddress');
    const route = await this.loadThruMintMetadataRoute(tokenMintAddress);
    return {
      thruTokenMintAddress: route.thruTokenMintAddress,
      thruMetadataAccountAddress: route.thruMetadataAccountAddress,
      destinationChainId: route.destinationChainId,
      polygonTokenAddressBytes32: route.polygonTokenAddressBytes32,
      polygonTokenAddress: route.polygonTokenAddress,
      isPolygonBridgedToken: route.isPolygonBridgedToken,
    };
  }

  async depositThruToPolygon(input: ThruToPolygonDepositRequest): Promise<ThruToPolygonDepositResult> {
    const thru = this.requireThru();
    const prepared = this.prepareThruToPolygonDeposit(input);
    const resolved = await this.resolveThruToPolygonDeposit(thru, prepared);
    const signed = await this.buildAndSignThruToPolygonDeposit(thru, prepared, resolved);
    const thruSignature = await this.sendThruDepositTransaction(thru, signed.rawTransaction, {
      instructionSize: signed.instructionSize,
      readWriteAccounts: resolved.readWriteAccounts.length,
      readOnlyAccounts: resolved.readOnlyAccounts.length,
    });

    return {
      thruSignature,
      rawAmount: prepared.rawAmount,
      thruTokenMintAddress: prepared.thruTokenMintAddress,
      thruTokenAccountAddress: resolved.thruTokenAccountAddress,
      thruMetadataAccountAddress: resolved.route.thruMetadataAccountAddress,
      bridgeManagerAddress: resolved.bridgeManagerAddress,
      feeCollectorAddress: resolved.feeCollectorAddress,
      feeVaultTokenAccountAddress: resolved.feeVaultTokenAccountAddress,
      polygonTokenAddress: resolved.route.polygonTokenAddress as string,
      polygonRecipientAddress: prepared.polygonRecipientAddress,
      polygonRecipientBytes32: normalizeHex(bytesToHex(prepared.recipientBytes32)),
    };
  }

  private prepareThruToPolygonDeposit(input: ThruToPolygonDepositRequest): PreparedThruToPolygonDeposit {
    const thruTokenMintAddress = validateThruAddress(input.thruTokenMintAddress, 'thruTokenMintAddress');
    const thruTokenAccountAddress = input.thruTokenAccountAddress
      ? validateThruAddress(input.thruTokenAccountAddress, 'thruTokenAccountAddress')
      : undefined;
    const polygonRecipientAddress = validateAddress(input.polygonRecipientAddress, 'polygonRecipientAddress');
    const rawAmount = assertU64Amount(input.rawAmount, 'rawAmount');
    if (rawAmount === 0n) {
      throw new Error('rawAmount must be > 0');
    }

    const payload = parseHexPayload(input.payloadHex);
    if (payload.length > BRIDGE_MAX_PAYLOAD_SIZE) {
      throw new Error(`payloadHex must be <= ${BRIDGE_MAX_PAYLOAD_SIZE} bytes`);
    }

    return {
      thruTokenMintAddress,
      thruTokenAccountAddress,
      polygonRecipientAddress,
      recipientBytes32: evmAddressToBytes32(polygonRecipientAddress),
      rawAmount,
      payload,
    };
  }

  private async resolveThruToPolygonDeposit(
    thru: ThruConfigState,
    input: PreparedThruToPolygonDeposit
  ): Promise<ResolvedThruToPolygonDeposit> {
    const route = await this.loadThruMintMetadataRoute(input.thruTokenMintAddress);
    if (!route.isPolygonBridgedToken || !route.polygonTokenAddress) {
      throw new Error(
        `thruTokenMintAddress is not a Polygon-bridged token (expected destinationChainId=${THRU_POLYGON_CHAIN_IDS.polygon})`
      );
    }

    const bridgeManagerAddress = this.deriveThruBridgeManagerAddress(thru, THRU_POLYGON_CHAIN_IDS.polygon);
    const feeCollectorAddress = await this.readThruFeeCollectorAddress(thru, bridgeManagerAddress);
    const depositorAddress = thru.feePayerAddress;
    const depositorBytes = decodeAddress(depositorAddress);
    const tokenMintBytes = decodeAddress(input.thruTokenMintAddress);

    const bridgedSeed = thru.client.helpers.deriveAddress([
      route.destinationTokenBytes,
      u16LE(route.destinationChainId),
    ]).bytes;
    const depositorTokenSeed = thru.client.helpers.deriveAddress([depositorBytes, bridgedSeed]).bytes;
    const thruTokenAccountAddress = input.thruTokenAccountAddress
      ? input.thruTokenAccountAddress
      : this.deriveThruTokenAccountAddress(thru, depositorAddress, input.thruTokenMintAddress, depositorTokenSeed);

    await this.assertThruTokenAccountBalance(
      thru,
      thruTokenAccountAddress,
      tokenMintBytes,
      depositorBytes,
      input.rawAmount
    );

    const feeCollectorBytes = decodeAddress(feeCollectorAddress);
    const feeTokenSeed = thru.client.helpers.deriveAddress([feeCollectorBytes, bridgedSeed]).bytes;
    const feeVaultTokenAccountAddress = this.deriveThruTokenAccountAddress(
      thru,
      feeCollectorAddress,
      input.thruTokenMintAddress,
      feeTokenSeed
    );
    const feeTokenProof = await this.getThruCreatingProofIfMissing(thru, feeVaultTokenAccountAddress);

    const accountLists = this.buildThruToPolygonDepositAccountLists({
      bridgeManagerAddress,
      thruTokenAccountAddress,
      thruTokenMintAddress: input.thruTokenMintAddress,
      feeVaultTokenAccountAddress,
      tokenProgramAddress: thru.tokenProgramAddress,
      metadataAccountAddress: route.thruMetadataAccountAddress,
      feeCollectorAddress,
      depositorAddress,
    });

    return {
      route,
      bridgeManagerAddress,
      feeCollectorAddress,
      depositorAddress,
      thruTokenAccountAddress,
      feeVaultTokenAccountAddress,
      feeTokenSeed,
      feeTokenProof,
      readWriteAccounts: accountLists.readWriteAccounts,
      readOnlyAccounts: accountLists.readOnlyAccounts,
    };
  }

  private buildThruToPolygonDepositAccountLists(input: {
    bridgeManagerAddress: string;
    thruTokenAccountAddress: string;
    thruTokenMintAddress: string;
    feeVaultTokenAccountAddress: string;
    tokenProgramAddress: string;
    metadataAccountAddress: string;
    feeCollectorAddress: string;
    depositorAddress: string;
  }): { readWriteAccounts: string[]; readOnlyAccounts: string[] } {
    // depositorAddress is the fee payer and is implicitly included by buildAndSign context.
    const readWriteAccounts = [
      input.bridgeManagerAddress,
      input.thruTokenAccountAddress,
      input.thruTokenMintAddress,
      input.feeVaultTokenAccountAddress,
    ];
    const readOnlyAccounts = [input.tokenProgramAddress, input.metadataAccountAddress];
    if (input.feeCollectorAddress !== input.depositorAddress && !readWriteAccounts.includes(input.feeCollectorAddress)) {
      readOnlyAccounts.push(input.feeCollectorAddress);
    }
    return { readWriteAccounts, readOnlyAccounts };
  }

  private async buildAndSignThruToPolygonDeposit(
    thru: ThruConfigState,
    input: PreparedThruToPolygonDeposit,
    resolved: ResolvedThruToPolygonDeposit
  ): Promise<{ rawTransaction: Uint8Array; instructionSize: number }> {
    let instructionSize = 0;
    const signed = await thru.client.transactions.buildAndSign({
      feePayer: {
        publicKey: thru.feePayerAddress,
        privateKey: thru.feePayerPrivateKey,
      },
      program: thru.bridgeProgramAddress,
      header: {
        chainId: THRU_POLYGON_CHAIN_IDS.thru,
      },
      accounts: {
        readWrite: resolved.readWriteAccounts,
        readOnly: resolved.readOnlyAccounts,
      },
      instructionData: async (context: { getAccountIndex: (address: string) => number }) => {
        const instruction = this.buildThruDepositInstruction({
          bridgeManagerAddress: resolved.bridgeManagerAddress,
          tokenProgramAddress: thru.tokenProgramAddress,
          tokenAccountAddress: resolved.thruTokenAccountAddress,
          tokenMintAddress: input.thruTokenMintAddress,
          metadataAccountAddress: resolved.route.thruMetadataAccountAddress,
          depositorAddress: resolved.depositorAddress,
          feeTokenAccountAddress: resolved.feeVaultTokenAccountAddress,
          feeCollectorAddress: resolved.feeCollectorAddress,
          recipientBytes32: input.recipientBytes32,
          amountRaw: input.rawAmount,
          feeTokenSeed: resolved.feeTokenSeed,
          payload: input.payload,
          feeTokenProof: resolved.feeTokenProof,
          getAccountIndex: context.getAccountIndex,
        });
        instructionSize = instruction.length;
        return instruction;
      },
    });

    return { rawTransaction: signed.rawTransaction, instructionSize };
  }

  private async sendThruDepositTransaction(
    thru: ThruConfigState,
    rawTransaction: Uint8Array,
    diagnostics: {
      instructionSize: number;
      readWriteAccounts: number;
      readOnlyAccounts: number;
    }
  ): Promise<string> {
    const { normalizedRawTransaction, legacySignaturePrefixed } = normalizeThruTransactionWire(rawTransaction);
    const rawHeader = readThruTxnHeader(normalizedRawTransaction);

    if (normalizedRawTransaction.length > THRU_TXN_MTU) {
      throw new Error(
        `transaction too large: rawTxBytes=${normalizedRawTransaction.length} exceeds Thru MTU=${THRU_TXN_MTU}. ` +
          `Try pre-creating the fee vault token account so no fee-token creating proof is attached.`
      );
    }

    try {
      return await thru.client.transactions.send(normalizedRawTransaction);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/parse failed/i.test(message)) {
        throw new Error(
          `transaction rejected: Parse failed (rawTxBytes=${normalizedRawTransaction.length}, ` +
            `instructionBytes=${diagnostics.instructionSize}, readWriteAccounts=${diagnostics.readWriteAccounts}, ` +
            `readOnlyAccounts=${diagnostics.readOnlyAccounts}, chainId=${THRU_POLYGON_CHAIN_IDS.thru}, ` +
            `header.version=${rawHeader.version}, header.flags=${rawHeader.flags}, ` +
            `header.rw=${rawHeader.readWriteAccounts}, header.ro=${rawHeader.readOnlyAccounts}, ` +
            `header.instr=${rawHeader.instructionDataSize}, header.chainId=${rawHeader.chainId}, ` +
            `legacySignaturePrefixed=${legacySignaturePrefixed})`
        );
      }
      throw error;
    }
  }

  private parsePolygonDepositLog(
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

    if (!parsed || parsed.name !== 'Deposit') return null;
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

  private extractPolygonDepositFromReceipt(receipt: TransactionReceipt): PolygonDepositEvent | null {
    const { bridgeAddress, bridgeIface } = this.requirePolygon();
    const bridgeAddressLower = bridgeAddress.toLowerCase();
    for (const log of receipt.logs) {
      const parsed = this.parsePolygonDepositLog(log, { bridgeAddressLower, bridgeIface });
      if (parsed) return parsed;
    }
    return null;
  }

  private async assertSufficientAllowance(polygonTokenAddress: string, amountRaw: bigint): Promise<void> {
    const { provider, signer, bridgeAddress } = this.requirePolygon();
    const token = new Contract(polygonTokenAddress, POLYGON_ERC20_ABI, provider);
    const owner = await signer.getAddress();
    const allowance = (await token.allowance(owner, bridgeAddress)) as bigint;
    if (allowance < amountRaw) {
      throw new Error(
        `insufficient allowance: approve at least ${amountRaw.toString()} for bridge ${bridgeAddress} by calling approvePolygonToken(...) first`
      );
    }
  }

  private async loadThruMintMetadataRoute(thruTokenMintAddress: string): Promise<ThruMintMetadataRoute> {
    const thru = this.requireThru();
    const tokenMintBytes = decodeAddress(thruTokenMintAddress);
    const metadata = thru.client.helpers.deriveProgramAddress({
      programAddress: thru.bridgeProgramAddress,
      seed: tokenMintBytes,
      ephemeral: false,
    });
    const metadataAccount = await thru.client.accounts.get(metadata.address, {
      view: AccountView.DATA_ONLY,
    });
    const metadataBytes = metadataAccount.data?.data;
    if (!metadataBytes || metadataBytes.length < BRIDGE_MINT_METADATA_SIZE) {
      throw new Error('bridge mint metadata account is missing or malformed');
    }

    const destinationChainId = readU16LE(metadataBytes, 0);
    const destinationTokenBytes = metadataBytes.slice(2, 34);
    const polygonTokenAddress = bytes32ToEvmAddress(destinationTokenBytes);
    const polygonTokenAddressBytes32 = normalizeHex(bytesToHex(destinationTokenBytes));
    return {
      thruTokenMintAddress,
      thruMetadataAccountAddress: metadata.address,
      destinationChainId,
      polygonTokenAddressBytes32,
      polygonTokenAddress,
      isPolygonBridgedToken: destinationChainId === THRU_POLYGON_CHAIN_IDS.polygon,
      destinationTokenBytes,
    };
  }

  private deriveThruBridgeManagerAddress(thru: ThruConfigState, chainId: number): string {
    return thru.client.helpers.deriveProgramAddress({
      programAddress: thru.bridgeProgramAddress,
      seed: `bridge_manager_${chainId}`,
      ephemeral: false,
    }).address;
  }

  private async readThruFeeCollectorAddress(thru: ThruConfigState, bridgeManagerAddress: string): Promise<string> {
    const bridgeAccount = await thru.client.accounts.get(bridgeManagerAddress, {
      view: AccountView.DATA_ONLY,
    });
    const data = bridgeAccount.data?.data;
    if (!data) {
      throw new Error('bridge manager account data is missing or malformed');
    }
    if (data.length < BRIDGE_FEE_COLLECTOR_OFFSET + 32) {
      throw new Error(
        'bridge manager account is missing fee collector extension; configure fee collector on-chain first'
      );
    }

    const feeCollectorBytes = data.slice(BRIDGE_FEE_COLLECTOR_OFFSET, BRIDGE_FEE_COLLECTOR_OFFSET + 32);
    if (isZeroBytes(feeCollectorBytes)) {
      throw new Error('bridge fee collector is not configured');
    }
    return encodeAddress(feeCollectorBytes);
  }

  private deriveThruTokenAccountAddress(
    thru: ThruConfigState,
    ownerAddress: string,
    mintAddress: string,
    seed: Uint8Array
  ): string {
    if (seed.length !== 32) {
      throw new Error('token account seed must be 32 bytes');
    }
    const ownerBytes = decodeAddress(ownerAddress);
    const mintBytes = decodeAddress(mintAddress);
    const derivedSeed = thru.client.helpers.deriveAddress([ownerBytes, mintBytes, seed]).bytes;
    return thru.client.helpers.deriveProgramAddress({
      programAddress: thru.tokenProgramAddress,
      seed: derivedSeed,
      ephemeral: false,
    }).address;
  }

  private async assertThruTokenAccountBalance(
    thru: ThruConfigState,
    tokenAccountAddress: string,
    expectedMintBytes: Uint8Array,
    expectedOwnerBytes: Uint8Array,
    requiredAmount: bigint
  ): Promise<void> {
    const account = await thru.client.accounts.get(tokenAccountAddress, {
      view: AccountView.DATA_ONLY,
    });
    const data = account.data?.data;
    if (!data || data.length < THRU_TOKEN_ACCOUNT_MIN_SIZE) {
      throw new Error('token account is missing or malformed');
    }

    const mintBytes = data.slice(0, 32);
    const ownerBytes = data.slice(32, 64);
    const amount = readU64LE(data, THRU_TOKEN_ACCOUNT_AMOUNT_OFFSET);
    if (!bytesEqual(mintBytes, expectedMintBytes)) {
      throw new Error('token account mint does not match thruTokenMintAddress');
    }
    if (!bytesEqual(ownerBytes, expectedOwnerBytes)) {
      throw new Error('token account owner does not match the configured Thru fee payer');
    }
    if (amount < requiredAmount) {
      throw new Error(`insufficient Thru token balance: have ${amount.toString()}, need ${requiredAmount.toString()}`);
    }
  }

  private async getThruCreatingProofIfMissing(thru: ThruConfigState, address: string): Promise<Uint8Array> {
    try {
      await thru.client.accounts.get(address, { view: AccountView.PUBKEY_ONLY });
      return new Uint8Array();
    } catch (err) {
      if (!isThruAccountNotFoundError(err)) {
        throw err;
      }
      const proof = await thru.client.proofs.generate({
        address,
        proofType: StateProofType.CREATING,
      });
      return proof.proof;
    }
  }

  private buildThruDepositInstruction(input: ThruDepositInstructionInput): Uint8Array {
    const bridgeAccountIdx = input.getAccountIndex(input.bridgeManagerAddress);
    const tokenProgramIdx = input.getAccountIndex(input.tokenProgramAddress);
    const tokenAccountIdx = input.getAccountIndex(input.tokenAccountAddress);
    const tokenMintIdx = input.getAccountIndex(input.tokenMintAddress);
    const metadataIdx = input.getAccountIndex(input.metadataAccountAddress);
    const depositorIdx = input.getAccountIndex(input.depositorAddress);
    const feeTokenAccountIdx = input.getAccountIndex(input.feeTokenAccountAddress);
    const feeCollectorIdx = input.getAccountIndex(input.feeCollectorAddress);

    if (input.payload.length > 0xffff) {
      throw new Error('payload too large for bridge deposit instruction');
    }
    if (input.feeTokenProof.length > 0xffff) {
      throw new Error('fee token state proof too large for bridge deposit instruction');
    }
    if (input.feeTokenSeed.length !== 32) {
      throw new Error('fee token account seed must be 32 bytes');
    }

    const instructionHead = concatBytes(
      u32LE(BRIDGE_INSTR_DEPOSIT),
      u16LE(bridgeAccountIdx),
      u16LE(THRU_POLYGON_CHAIN_IDS.polygon),
      u16LE(tokenProgramIdx),
      u16LE(tokenAccountIdx),
      u16LE(tokenMintIdx),
      u16LE(metadataIdx),
      u16LE(depositorIdx),
      u16LE(feeTokenAccountIdx),
      u16LE(feeCollectorIdx),
      decodeAddress(input.tokenMintAddress),
      decodeAddress(input.depositorAddress),
      input.recipientBytes32,
      u64LE(input.amountRaw),
      input.feeTokenSeed,
      // Header field order matches tn_bridge_deposit_args_t:
      // fee_token_account_proof_len, payload_len.
      // Variable data order is payload first, then fee-token proof (per on-chain parser).
      u16LE(input.feeTokenProof.length),
      u16LE(input.payload.length)
    );

    return concatBytes(instructionHead, input.payload, input.feeTokenProof);
  }

  private requirePolygon(): {
    provider: Provider;
    signer: Signer;
    bridgeAddress: string;
    bridgeContract: Contract;
    bridgeIface: Interface;
  } {
    if (
      !this.polygonProvider ||
      !this.polygonSigner ||
      !this.polygonBridgeAddress ||
      !this.polygonBridgeContract ||
      !this.polygonBridgeIface
    ) {
      throw new Error('Polygon config is required for this operation');
    }
    return {
      provider: this.polygonProvider,
      signer: this.polygonSigner,
      bridgeAddress: this.polygonBridgeAddress,
      bridgeContract: this.polygonBridgeContract,
      bridgeIface: this.polygonBridgeIface,
    };
  }

  private requireThru(): ThruConfigState {
    if (!this.thru) {
      throw new Error('Thru config is required for this operation');
    }
    return this.thru;
  }

  private buildSignerAndProvider(config: PolygonSignerConfig): { signer: Signer; provider: Provider } {
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
}

export function createBridgeClient(config: BridgeClientConfig): BridgeClient {
  return new BridgeClient(config);
}
