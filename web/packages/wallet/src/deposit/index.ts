/* Deposit helpers for the wallet "Add funds" lifecycle.
 *
 * The wallet derives and optionally creates the user's configured token account;
 * the backend mints after a verified Unifold webhook. DApps should use the SDK
 * methods exposed by BrowserSDK/NativeSDK/useWallet. The explicit `ForWallet`
 * helpers are kept for the embedded wallet app, where the selected wallet
 * account is already known inside the iframe. */

import { decodeAddress } from "@thru/sdk/helpers";
import type { Thru } from "@thru/sdk/client";
import {
  buildWalletAccountContext,
  bytesToBase64,
} from "@thru/programs/passkey-manager";
import {
  bytesToHex,
  createInitializeAccountInstruction,
  deriveTokenAccountAddress,
  formatRawAmount,
  parseTokenAccountData,
} from "@thru/programs/token";
import { base64ToBytes } from "../encoding";
import type { ThruTransactionReviewPayload } from "../interfaces";
import {
  DepositTarget,
  ThruNetwork,
  type DepositDestination,
  type DepositRequestPayload,
  type DepositResult,
  type PrepareDepositPayload,
} from "../protocol";

declare const process:
  | {
      env: {
        NEXT_PUBLIC_THRU_DEPOSIT_NETWORK_CONFIG_JSON?: string;
        NEXT_PUBLIC_THRU_DEPOSIT_DEFAULT_NETWORK?: string;
        NEXT_PUBLIC_TOKEN_PROGRAM_ADDRESS?: string;
        EXPO_PUBLIC_THRU_DEPOSIT_NETWORK_CONFIG_JSON?: string;
        EXPO_PUBLIC_THRU_DEPOSIT_DEFAULT_NETWORK?: string;
        EXPO_PUBLIC_TOKEN_PROGRAM_ADDRESS?: string;
      };
    }
  | undefined;

export const DEFAULT_DEPOSIT_SYMBOL = "CREDITS";
export const DEFAULT_DEPOSIT_DECIMALS = 6;
export const DEFAULT_DEPOSIT_TARGET = DepositTarget.Credits;
export const CREDITS_TICKER = DEFAULT_DEPOSIT_SYMBOL;
export const CREDITS_DECIMALS = DEFAULT_DEPOSIT_DECIMALS;

const DEFAULT_TOKEN_PROGRAM_ADDRESS =
  "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKqq";
const TOKEN_ACCOUNT_DEFAULT_SEED = new Uint8Array(32);
const STATE_PROOF_TYPE_CREATING = 1;
const ACCOUNT_STATE_WAIT_TIMEOUT_MS = 90_000;
const ACCOUNT_STATE_POLL_MS = 1_000;

const TOKEN_PROGRAM_ERROR_LABELS: Record<number, string> = {
  1: "Invalid instruction data size",
  2: "Invalid instruction",
  4: "Insufficient funds",
  5: "Owner mismatch",
  6: "Authority mismatch",
  7: "Missing required signer",
  8: "Account frozen",
  9: "Account not owned by program",
  10: "Invalid mint",
  11: "Non-zero balance",
  12: "Invalid account data size",
  13: "Overflow",
  14: "Mint mismatch",
  15: "Incorrect program id",
  16: "Invalid transaction",
  17: "Invalid proof",
  18: "Invalid account",
  19: "Mint cannot freeze",
  20: "Syscall failed",
};

const VM_ERROR_LABELS: Record<number, string> = {
  0: "Success",
  [-767]: "VM failed",
  [-766]: "Invalid program account",
  [-765]: "Program reverted",
  [-764]: "Compute units exhausted",
  [-763]: "State units exhausted",
};

export interface DepositTargetConfig {
  network: string;
  depositTarget: string;
  rpcUrl?: string;
  mintAddress: string;
  symbol: string;
  decimals: number;
  tokenProgramAddress: string;
}

export interface DepositUnifoldProjectConfig {
  projectId: string;
  publishableKey: string;
  treasuryAddress: string;
  destinationChainType: string;
  destinationChainId: string;
  destinationTokenAddress: string;
  destinationTokenSymbol: string;
}

export interface DepositNetworkConfig {
  network: string;
  unifoldProject: DepositUnifoldProjectConfig;
  defaultDepositTarget: string;
  depositTargets: Map<string, DepositTargetConfig>;
}

export interface DepositAccountState {
  destination: DepositDestination;
  balanceRaw: bigint;
  balanceLabel: string;
  lastSetupSignature?: string;
}

export type EnsureDepositAccountParams = {
  destination?: DepositDestination;
};

export type GetDepositAccountStateParams = {
  destination?: DepositDestination;
};

export type WaitForDepositBalanceParams = {
  destination: DepositDestination;
  minimumBalanceRaw: bigint;
  signature?: string;
};

export interface DepositsApi {
  prepare(
    targetOrPayload?: DepositTarget | PrepareDepositPayload,
  ): Promise<DepositDestination>;
  ensureAccount(
    params?: EnsureDepositAccountParams,
  ): Promise<DepositAccountState>;
  open(payload: DepositRequestPayload): Promise<DepositResult>;
  getAccountState(
    params?: GetDepositAccountStateParams,
  ): Promise<DepositAccountState>;
  waitForBalance(
    params: WaitForDepositBalanceParams,
  ): Promise<DepositAccountState>;
  formatAmount(amountRaw: bigint, destination: DepositDestination): string;
}

export type SignDepositTransactionPayload = {
  trailingInstructionData: string;
  walletAddress: string;
  readWriteAddresses: string[];
  readOnlyAddresses: string[];
  programAddress: string;
  authIdx?: number;
  review?: ThruTransactionReviewPayload;
};

export type SignDepositTransaction = (
  payload: SignDepositTransactionPayload,
) => Promise<string>;

export class DepositTransactionError extends Error {
  signature: string;

  constructor(message: string, signature: string) {
    super(message);
    this.name = "DepositTransactionError";
    this.signature = signature;
    Object.setPrototypeOf(this, DepositTransactionError.prototype);
  }
}

type RawDepositTargetConfig = {
  rpc_url?: string;
  mint_address?: string;
  symbol?: string;
  decimals?: number;
  token_program_address?: string;
};

type RawNetworkConfig = Record<
  string,
  {
    unifold_project?: {
      project_id?: string;
      publishable_key?: string;
      treasury_address?: string;
      destination_chain_type?: string;
      destination_chain_id?: string;
      destination_token_address?: string;
      destination_token_symbol?: string;
    };
    default_deposit_target?: string;
    deposit_targets?: Record<string, RawDepositTargetConfig>;
  }
>;

interface DepositAccounts {
  walletAddress: string;
  mintAddress: string;
  mintAccountBytes: Uint8Array;
  tokenAccountAddress: string;
  tokenAccountBytes: Uint8Array;
  walletBytes: Uint8Array;
  destination: DepositDestination;
}

type PublicDepositEnvName =
  | "NEXT_PUBLIC_THRU_DEPOSIT_NETWORK_CONFIG_JSON"
  | "NEXT_PUBLIC_THRU_DEPOSIT_DEFAULT_NETWORK"
  | "NEXT_PUBLIC_TOKEN_PROGRAM_ADDRESS"
  | "EXPO_PUBLIC_THRU_DEPOSIT_NETWORK_CONFIG_JSON"
  | "EXPO_PUBLIC_THRU_DEPOSIT_DEFAULT_NETWORK"
  | "EXPO_PUBLIC_TOKEN_PROGRAM_ADDRESS";

export interface DepositRuntimeConfig {
  networkConfigJson?: string;
  defaultNetwork?: string;
}

export interface DepositConfig {
  getNetwork(network?: string): DepositNetworkConfig;
  getTarget(network?: string, depositTarget?: string): DepositTargetConfig;
}

function readPublicEnv(name: PublicDepositEnvName): string | undefined {
  if (typeof process === "undefined") return undefined;
  /* Next only inlines NEXT_PUBLIC_* values when the property access is
     statically visible to its client compiler. Keep this switch explicit: the
     wallet's embedded browser bundle must receive the same config as Node. */
  const value =
    name === "NEXT_PUBLIC_THRU_DEPOSIT_NETWORK_CONFIG_JSON"
      ? process.env.NEXT_PUBLIC_THRU_DEPOSIT_NETWORK_CONFIG_JSON
      : name === "NEXT_PUBLIC_THRU_DEPOSIT_DEFAULT_NETWORK"
        ? process.env.NEXT_PUBLIC_THRU_DEPOSIT_DEFAULT_NETWORK
        : name === "NEXT_PUBLIC_TOKEN_PROGRAM_ADDRESS"
          ? process.env.NEXT_PUBLIC_TOKEN_PROGRAM_ADDRESS
          : name === "EXPO_PUBLIC_THRU_DEPOSIT_NETWORK_CONFIG_JSON"
            ? process.env.EXPO_PUBLIC_THRU_DEPOSIT_NETWORK_CONFIG_JSON
            : name === "EXPO_PUBLIC_THRU_DEPOSIT_DEFAULT_NETWORK"
              ? process.env.EXPO_PUBLIC_THRU_DEPOSIT_DEFAULT_NETWORK
              : process.env.EXPO_PUBLIC_TOKEN_PROGRAM_ADDRESS;
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function resolveDepositConfigSource(
  runtimeConfig?: DepositRuntimeConfig,
): DepositRuntimeConfig {
  /* A supplied runtime object is authoritative, including an empty object.
     Environment fallback is source-level only so runtime and build-time
     configuration can never be mixed field-by-field. */
  if (runtimeConfig !== undefined) return runtimeConfig;
  return {
    networkConfigJson:
      readPublicEnv("NEXT_PUBLIC_THRU_DEPOSIT_NETWORK_CONFIG_JSON") ??
      readPublicEnv("EXPO_PUBLIC_THRU_DEPOSIT_NETWORK_CONFIG_JSON"),
    defaultNetwork:
      readPublicEnv("NEXT_PUBLIC_THRU_DEPOSIT_DEFAULT_NETWORK") ??
      readPublicEnv("EXPO_PUBLIC_THRU_DEPOSIT_DEFAULT_NETWORK"),
  };
}

export const DEPOSIT_TOKEN_PROGRAM_ADDRESS =
  readPublicEnv("NEXT_PUBLIC_TOKEN_PROGRAM_ADDRESS") ??
  readPublicEnv("EXPO_PUBLIC_TOKEN_PROGRAM_ADDRESS") ??
  DEFAULT_TOKEN_PROGRAM_ADDRESS;
export const CREDITS_TOKEN_PROGRAM_ADDRESS = DEPOSIT_TOKEN_PROGRAM_ADDRESS;

function parseDepositNetworkConfigs(
  json?: string,
): Map<string, DepositNetworkConfig> {
  const normalizedJson = json?.trim();
  if (!normalizedJson) return new Map();

  const parsed = JSON.parse(normalizedJson) as RawNetworkConfig;
  return new Map(
    Object.entries(parsed).map(([network, value]) => {
      const project = value.unifold_project;
      if (!project?.project_id) {
        throw new Error(
          `Deposit config for network ${network} is missing unifold_project.project_id`,
        );
      }
      if (!project.publishable_key) {
        throw new Error(
          `Deposit config for network ${network} is missing unifold_project.publishable_key`,
        );
      }
      if (!project.treasury_address) {
        throw new Error(
          `Deposit config for network ${network} is missing unifold_project.treasury_address`,
        );
      }
      if (!project.destination_token_address) {
        throw new Error(
          `Deposit config for network ${network} is missing unifold_project.destination_token_address`,
        );
      }

      const rawTargets = value.deposit_targets ?? {};
      const targetEntries = Object.entries(rawTargets);
      if (targetEntries.length === 0) {
        throw new Error(
          `Deposit config for network ${network} must contain deposit_targets`,
        );
      }

      const defaultDepositTarget =
        value.default_deposit_target || DEFAULT_DEPOSIT_TARGET;
      const depositTargets = new Map(
        targetEntries.map(([depositTarget, target]) => {
          if (!target.mint_address) {
            throw new Error(
              `Deposit config for network ${network} target ${depositTarget} is missing mint_address`,
            );
          }
          return [
            depositTarget,
            {
              network,
              depositTarget,
              rpcUrl: target.rpc_url,
              mintAddress: target.mint_address,
              symbol: target.symbol || DEFAULT_DEPOSIT_SYMBOL,
              decimals:
                target.decimals === undefined
                  ? DEFAULT_DEPOSIT_DECIMALS
                  : Number(target.decimals),
              tokenProgramAddress:
                target.token_program_address || DEPOSIT_TOKEN_PROGRAM_ADDRESS,
            },
          ] as const;
        }),
      );
      if (!depositTargets.has(defaultDepositTarget)) {
        throw new Error(
          `Deposit config for network ${network} default_deposit_target ${defaultDepositTarget} is missing`,
        );
      }

      return [
        network,
        {
          network,
          unifoldProject: {
            projectId: project.project_id,
            publishableKey: project.publishable_key,
            treasuryAddress: project.treasury_address,
            destinationChainType: project.destination_chain_type || "solana",
            destinationChainId: project.destination_chain_id || "mainnet",
            destinationTokenAddress: project.destination_token_address,
            destinationTokenSymbol: project.destination_token_symbol || "USDC",
          },
          defaultDepositTarget,
          depositTargets,
        },
      ] as const;
    }),
  );
}

/** @deprecated Create one `DepositConfig` and reuse its lookup methods. */
export function readDepositNetworkConfigs(
  runtimeConfig?: DepositRuntimeConfig,
): Map<string, DepositNetworkConfig> {
  const source = resolveDepositConfigSource(runtimeConfig);
  return parseDepositNetworkConfigs(source.networkConfigJson);
}

/** Parse and validate deposit configuration once, then reuse its lookup API.
 *
 * Omit `runtimeConfig` to read public build-time environment variables. Passing
 * any runtime object, including `{}`, suppresses that fallback intentionally.
 */
export function createDepositConfig(
  runtimeConfig?: DepositRuntimeConfig,
): DepositConfig {
  const source = resolveDepositConfigSource(runtimeConfig);
  const configs = parseDepositNetworkConfigs(source.networkConfigJson);
  const defaultNetwork = source.defaultNetwork?.trim() || null;

  const getNetwork = (network?: string): DepositNetworkConfig => {
    const selected = network ?? defaultNetwork ?? configs.keys().next().value;
    const config = selected ? configs.get(selected) : undefined;
    if (!config) {
      throw new Error(
        "NEXT_PUBLIC_THRU_DEPOSIT_NETWORK_CONFIG_JSON is not configured for deposits",
      );
    }
    return config;
  };

  return Object.freeze({
    getNetwork,
    getTarget(network?: string, depositTarget?: string): DepositTargetConfig {
      const networkConfig = getNetwork(network);
      const selectedTarget =
        depositTarget ?? networkConfig.defaultDepositTarget;
      const config = networkConfig.depositTargets.get(selectedTarget);
      if (!config) {
        throw new Error(
          `NEXT_PUBLIC_THRU_DEPOSIT_NETWORK_CONFIG_JSON is missing target ${selectedTarget} for ${networkConfig.network}`,
        );
      }
      return config;
    },
  });
}

export function getDefaultDepositNetwork(
  runtimeConfig?: DepositRuntimeConfig,
): string | null {
  return (
    resolveDepositConfigSource(runtimeConfig).defaultNetwork?.trim() || null
  );
}

/** @deprecated Create one `DepositConfig` and call `getNetwork`. */
export function getDepositNetworkConfig(
  network?: string,
  runtimeConfig?: DepositRuntimeConfig,
): DepositNetworkConfig {
  return createDepositConfig(runtimeConfig).getNetwork(network);
}

/** @deprecated Create one `DepositConfig` and call `getTarget`. */
export function getDepositTargetConfig(
  network?: string,
  depositTarget?: string,
  runtimeConfig?: DepositRuntimeConfig,
): DepositTargetConfig {
  return createDepositConfig(runtimeConfig).getTarget(network, depositTarget);
}

export function getCreditsMintAddress(): string {
  return getDepositTargetConfig().mintAddress;
}

export function parseDepositAmount(
  input: string,
  decimals: number,
): bigint | null {
  const value = input.trim().replace(/,/g, "");
  const pattern = new RegExp(`^\\d+(?:\\.\\d{0,${decimals}})?$`);
  if (!pattern.test(value)) return null;

  const [whole = "0", fraction = ""] = value.split(".");
  const raw =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0"));

  return raw > 0n ? raw : null;
}

export function parseCreditsAmount(input: string): bigint | null {
  return parseDepositAmount(input, CREDITS_DECIMALS);
}

export function formatDepositAmount(
  amountRaw: bigint,
  decimalsOrDestination: number | DepositDestination = DEFAULT_DEPOSIT_DECIMALS,
): string {
  const decimals =
    typeof decimalsOrDestination === "number"
      ? decimalsOrDestination
      : decimalsOrDestination.decimals;
  const formatted = formatRawAmount(amountRaw, decimals);
  const [whole, fraction] = formatted.split(".");
  const wholeLabel = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${wholeLabel}.${fraction}` : wholeLabel;
}

export function formatCreditsAmount(amountRaw: bigint): string {
  return formatDepositAmount(amountRaw, CREDITS_DECIMALS);
}

export function buildDepositDestination(params: {
  thru: Thru;
  walletAddress: string;
  network?: string;
  depositTarget?: string;
  depositConfig?: DepositConfig;
  runtimeConfig?: DepositRuntimeConfig;
}): DepositDestination {
  const depositConfig =
    params.depositConfig ?? createDepositConfig(params.runtimeConfig);
  const config = depositConfig.getTarget(params.network, params.depositTarget);
  const tokenAccount = deriveDepositAccount(params.thru, params.walletAddress, {
    mintAddress: config.mintAddress,
    tokenProgramAddress: config.tokenProgramAddress,
  });
  return {
    network: normalizeNetwork(config.network),
    depositTarget: normalizeDepositTarget(config.depositTarget),
    tokenAccountAddress: tokenAccount.address,
    mintAddress: config.mintAddress,
    tokenProgramAddress: config.tokenProgramAddress,
    symbol: config.symbol,
    decimals: config.decimals,
  };
}

export function deriveDepositAccount(
  thru: Thru,
  walletAddress: string,
  destination: Pick<DepositDestination, "mintAddress" | "tokenProgramAddress">,
): { address: string; bytes: Uint8Array } {
  const { address, bytes } = deriveTokenAccountAddress(
    thru,
    walletAddress,
    destination.mintAddress,
    destination.tokenProgramAddress,
    TOKEN_ACCOUNT_DEFAULT_SEED,
  );
  return { address, bytes };
}

export async function ensureDepositAccountForWallet(params: {
  thru: Thru;
  walletAddress: string;
  signTransaction: SignDepositTransaction;
  destination: DepositDestination;
}): Promise<DepositAccountState> {
  const accounts = deriveDepositAccounts(
    params.thru,
    params.walletAddress,
    params.destination,
  );

  const [mintExists, tokenAccountExists] = await Promise.all([
    accountExists(params.thru, accounts.mintAddress),
    accountExists(params.thru, accounts.tokenAccountAddress),
  ]);

  if (!mintExists) {
    throw new Error(
      `${params.destination.symbol} mint ${accounts.mintAddress} does not exist on-chain`,
    );
  }

  let lastSetupSignature: string | undefined;
  if (!tokenAccountExists) {
    lastSetupSignature = await initializeDepositAccount(
      params.thru,
      params.signTransaction,
      accounts,
    );
  }

  const state = await waitForDepositAccountState(
    params.thru,
    params.walletAddress,
    params.destination,
  );
  return { ...state, lastSetupSignature };
}

export async function getDepositAccountStateForWallet(params: {
  thru: Thru;
  walletAddress: string;
  destination: DepositDestination;
}): Promise<DepositAccountState> {
  const accounts = deriveDepositAccounts(
    params.thru,
    params.walletAddress,
    params.destination,
  );

  try {
    return await readExistingDepositAccountState(params.thru, accounts);
  } catch (err) {
    if (isNotFoundError(err)) {
      return {
        destination: params.destination,
        balanceRaw: 0n,
        balanceLabel: formatDepositAmount(0n, params.destination),
      };
    }
    throw err;
  }
}

export async function validateDepositAccountState(params: {
  thru: Thru;
  walletAddress: string;
  destination: DepositDestination;
}): Promise<DepositAccountState> {
  const accounts = deriveDepositAccounts(
    params.thru,
    params.walletAddress,
    params.destination,
  );
  if (accounts.tokenAccountAddress !== params.destination.tokenAccountAddress) {
    throw new Error(
      `${params.destination.symbol} account does not match the selected wallet and mint`,
    );
  }
  return readExistingDepositAccountState(params.thru, accounts);
}

export async function waitForDepositAccountState(
  thru: Thru,
  walletAddress: string,
  destination: DepositDestination,
): Promise<DepositAccountState> {
  const accounts = deriveDepositAccounts(thru, walletAddress, destination);
  const startedAt = Date.now();
  let lastError: unknown = null;

  while (Date.now() - startedAt < ACCOUNT_STATE_WAIT_TIMEOUT_MS) {
    try {
      return await readExistingDepositAccountState(thru, accounts);
    } catch (err) {
      lastError = err;
      if (!isNotFoundError(err)) throw err;
    }

    await sleep(ACCOUNT_STATE_POLL_MS);
  }

  const message = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new Error(
    `${destination.symbol} account was not found after setup${message}`,
  );
}

export async function waitForDepositBalanceForWallet(params: {
  thru: Thru;
  walletAddress: string;
  destination: DepositDestination;
  minimumBalanceRaw: bigint;
  signature?: string;
}): Promise<DepositAccountState> {
  const accounts = deriveDepositAccounts(
    params.thru,
    params.walletAddress,
    params.destination,
  );
  const startedAt = Date.now();
  let latestState: DepositAccountState | null = null;

  while (Date.now() - startedAt < ACCOUNT_STATE_WAIT_TIMEOUT_MS) {
    try {
      latestState = await readExistingDepositAccountState(
        params.thru,
        accounts,
      );
      if (latestState.balanceRaw >= params.minimumBalanceRaw) {
        return latestState;
      }
    } catch (err) {
      if (!isNotFoundError(err)) throw err;
    }

    if (params.signature) {
      await throwIfTransactionFailed(params.thru, params.signature, "MintTo");
    }

    await sleep(ACCOUNT_STATE_POLL_MS);
  }

  const latestBalance = latestState
    ? `${latestState.balanceLabel} ${params.destination.symbol}`
    : "unknown";
  const message =
    `Deposit confirmed off-chain, but the ${params.destination.symbol} balance did not update after ` +
    `${ACCOUNT_STATE_WAIT_TIMEOUT_MS / 1000}s. Latest balance: ${latestBalance}`;
  if (params.signature) {
    throw new DepositTransactionError(message, params.signature);
  }
  throw new Error(message);
}

function deriveDepositAccounts(
  thru: Thru,
  walletAddress: string,
  destination: DepositDestination,
): DepositAccounts {
  const walletBytes = decodeAddress(walletAddress);
  const mintAccountBytes = decodeAddress(destination.mintAddress);
  const { address: tokenAccountAddress, bytes: tokenAccountBytes } =
    deriveTokenAccountAddress(
      thru,
      walletAddress,
      destination.mintAddress,
      destination.tokenProgramAddress,
      TOKEN_ACCOUNT_DEFAULT_SEED,
    );

  return {
    walletAddress,
    mintAddress: destination.mintAddress,
    mintAccountBytes,
    tokenAccountAddress,
    tokenAccountBytes,
    walletBytes,
    destination,
  };
}

async function initializeDepositAccount(
  thru: Thru,
  signTransaction: SignDepositTransaction,
  accounts: DepositAccounts,
): Promise<string> {
  const stateProof = await getStateProof(thru, accounts.tokenAccountAddress);
  const instructionData = createInitializeAccountInstruction({
    tokenAccountBytes: accounts.tokenAccountBytes,
    mintAccountBytes: accounts.mintAccountBytes,
    ownerAccountBytes: accounts.walletBytes,
    seedBytes: TOKEN_ACCOUNT_DEFAULT_SEED,
    stateProof,
  });

  const tokenProgramBytes = decodeAddress(
    accounts.destination.tokenProgramAddress,
  );
  const context = buildWalletAccountContext({
    walletAddress: accounts.walletAddress,
    readWriteAccounts: [accounts.tokenAccountBytes],
    readOnlyAccounts: [tokenProgramBytes, accounts.mintAccountBytes],
  });
  const tokenInstruction = await instructionData(context);
  const rawHex = bytesToHex(tokenInstruction);

  const signedBase64 = await signTransaction({
    trailingInstructionData: bytesToBase64(tokenInstruction),
    walletAddress: accounts.walletAddress,
    readWriteAddresses: context.readWriteAddresses,
    readOnlyAddresses: context.readOnlyAddresses,
    programAddress: accounts.destination.tokenProgramAddress,
    review: {
      appName: "Thru Wallet",
      programAddress: accounts.destination.tokenProgramAddress,
      abiName: "token_program.InitializeAccount",
      instruction: `initialize_token_account(symbol: ${accounts.destination.symbol})`,
      abiReflection: {
        label: `Set up ${accounts.destination.symbol} account`,
        kind: "instruction",
        typeName: "token_program.InitializeAccount",
        rawHex,
        source: "wallet-deposit",
      },
    },
  });

  const signature = await thru.transactions.send(base64ToBytes(signedBase64));
  await waitForAccount(
    thru,
    accounts.tokenAccountAddress,
    "InitializeAccount",
    signature,
  );
  return signature;
}

async function getStateProof(thru: Thru, address: string): Promise<Uint8Array> {
  const proof = await thru.proofs.generate({
    address,
    proofType: STATE_PROOF_TYPE_CREATING,
  });

  if (!proof.proof || proof.proof.length === 0) {
    throw new Error("State proof is required to create token account state");
  }

  return proof.proof;
}

async function accountExists(thru: Thru, address: string): Promise<boolean> {
  try {
    await thru.accounts.get(address);
    return true;
  } catch (err) {
    if (isNotFoundError(err)) return false;
    throw err;
  }
}

async function waitForAccount(
  thru: Thru,
  address: string,
  label: string,
  signature: string,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < ACCOUNT_STATE_WAIT_TIMEOUT_MS) {
    try {
      await thru.accounts.get(address);
      return;
    } catch (err) {
      if (!isNotFoundError(err)) throw err;
    }

    await throwIfTransactionFailed(thru, signature, label);
    await sleep(ACCOUNT_STATE_POLL_MS);
  }

  throw new DepositTransactionError(
    `${label} transaction posted, but account state did not appear after ${
      ACCOUNT_STATE_WAIT_TIMEOUT_MS / 1000
    }s`,
    signature,
  );
}

async function readExistingDepositAccountState(
  thru: Thru,
  accounts: DepositAccounts,
): Promise<DepositAccountState> {
  const account = await thru.accounts.get(accounts.tokenAccountAddress);
  const tokenInfo = parseTokenAccountData(account);
  if (tokenInfo.mint !== accounts.mintAddress) {
    throw new Error(
      `${accounts.destination.symbol} account mint does not match`,
    );
  }
  if (tokenInfo.owner !== accounts.walletAddress) {
    throw new Error(
      `${accounts.destination.symbol} account owner does not match`,
    );
  }

  return {
    destination: accounts.destination,
    balanceRaw: tokenInfo.amount,
    balanceLabel: formatDepositAmount(
      tokenInfo.amount,
      accounts.destination.decimals,
    ),
  };
}

async function throwIfTransactionFailed(
  thru: Thru,
  signature: string,
  label: string,
): Promise<void> {
  try {
    const status = await thru.transactions.getStatus(signature);
    const execution = status.executionResult;
    if (!execution) return;
    if (
      execution.executionResult !== 0n ||
      execution.userErrorCode !== 0n ||
      execution.vmError !== 0
    ) {
      throw new DepositTransactionError(
        `${label} failed: ${formatExecutionError(
          execution.executionResult,
          execution.vmError,
          execution.userErrorCode,
        )}`,
        signature,
      );
    }
  } catch (err) {
    if (err instanceof DepositTransactionError) throw err;
  }
}

function formatExecutionError(
  executionResult: bigint,
  vmError: number,
  userErrorCode: bigint,
): string {
  const vmLabel = VM_ERROR_LABELS[vmError] ?? `VM error ${vmError}`;
  const userCode = Number(userErrorCode);
  const tokenLabel =
    userErrorCode !== 0n
      ? (TOKEN_PROGRAM_ERROR_LABELS[userCode] ??
        `Token program error ${userCode}`)
      : "None";

  return [
    `${vmLabel} (vm=${vmError})`,
    `execution=${executionResult.toString()}`,
    `user=${userErrorCode.toString()} (${tokenLabel})`,
  ].join(", ");
}

function isNotFoundError(err: unknown): boolean {
  const errObj =
    err && typeof err === "object"
      ? (err as { code?: unknown; rawMessage?: unknown; status?: unknown })
      : null;
  const maybeCode = errObj?.code ?? errObj?.status;
  if (maybeCode === 5) return true;
  if (
    typeof maybeCode === "string" &&
    maybeCode.toLowerCase().includes("not_found")
  ) {
    return true;
  }

  const fallbackMessage = err instanceof Error ? err.message : String(err);
  const message = String(errObj?.rawMessage ?? fallbackMessage).toLowerCase();
  return message.includes("not_found") || message.includes("not found");
}

function normalizeNetwork(network: string): ThruNetwork {
  if ((Object.values(ThruNetwork) as string[]).includes(network)) {
    return network as ThruNetwork;
  }
  throw new Error(`Unsupported deposit network ${network}`);
}

function normalizeDepositTarget(depositTarget: string): DepositTarget {
  if ((Object.values(DepositTarget) as string[]).includes(depositTarget)) {
    return depositTarget as DepositTarget;
  }
  throw new Error(`Unsupported deposit target ${depositTarget}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
