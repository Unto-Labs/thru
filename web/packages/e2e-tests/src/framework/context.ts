import type { TestConfig } from "./config";

// We use 'any' for SDK types to avoid tight coupling to thru-sdk internals
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ThruSdk = any;
import type { GenesisAccount, GenesisAccountPool } from "../accounts";
import type { BlockSender } from "../block";
import type { AccountStateTracker } from "../state";
import type { SeededRNG } from "../utils";

/**
 * TestContext provides all the resources needed for a test scenario
 */
export interface TestContext {
  /** ThruSdk SDK client */
  sdk: ThruSdk;

  /** Genesis account allocated for this test */
  genesisAccount: GenesisAccount;

  /** Genesis account pool (shared across tests) */
  accountPool: GenesisAccountPool;

  /** Test configuration */
  config: TestConfig;

  /** Seeded random number generator for deterministic tests */
  rng: SeededRNG;

  /** Block sender for submitting blocks */
  blockSender: BlockSender;

  /** Account state tracker for monitoring account changes */
  accountStateTracker: AccountStateTracker;

  /** Test execution start time */
  startTime: number;

  /** AbortSignal for cancellation */
  signal: AbortSignal;

  /** Logging methods */
  logInfo(format: string, ...args: unknown[]): void;
  logDebug(format: string, ...args: unknown[]): void;
  logError(format: string, ...args: unknown[]): void;

  /** Get elapsed time since test started in milliseconds */
  elapsed(): number;

  /** Acquire multiple genesis accounts from the pool */
  getGenesisAccounts(count: number): GenesisAccount[];

  /** Release genesis accounts back to the pool */
  releaseGenesisAccounts(accounts: GenesisAccount[]): void;
}

export interface TestLogger {
  info(message: string): void;
  debug(message: string): void;
  error(message: string): void;
}

export class E2ELogger implements TestLogger {
  constructor(
    private readonly scenarioName: string,
    private readonly verbose: boolean
  ) {}

  info(message: string): void {
    console.log(`[${this.scenarioName}] ${message}`);
  }

  debug(message: string): void {
    if (this.verbose) {
      console.log(`[${this.scenarioName}] DEBUG: ${message}`);
    }
  }

  error(message: string): void {
    console.error(`[${this.scenarioName}] ERROR: ${message}`);
  }
}

export function createTestContext(
  sdk: ThruSdk,
  genesisAccount: GenesisAccount,
  accountPool: GenesisAccountPool,
  config: TestConfig,
  rng: SeededRNG,
  blockSender: BlockSender,
  accountStateTracker: AccountStateTracker,
  logger: TestLogger,
  signal: AbortSignal
): TestContext {
  const startTime = Date.now();

  return {
    sdk,
    genesisAccount,
    accountPool,
    config,
    rng,
    blockSender,
    accountStateTracker,
    startTime,
    signal,

    logInfo(format: string, ...args: unknown[]): void {
      logger.info(formatMessage(format, args));
    },

    logDebug(format: string, ...args: unknown[]): void {
      logger.debug(formatMessage(format, args));
    },

    logError(format: string, ...args: unknown[]): void {
      logger.error(formatMessage(format, args));
    },

    elapsed(): number {
      return Date.now() - startTime;
    },

    getGenesisAccounts(count: number): GenesisAccount[] {
      const accounts = accountPool.acquireMultiple(count);
      if (!accounts) {
        throw new Error(
          `Failed to acquire ${count} genesis accounts (available: ${accountPool.availableCount()})`
        );
      }
      return accounts;
    },

    releaseGenesisAccounts(accounts: GenesisAccount[]): void {
      accountPool.releaseMultiple(accounts);
    },
  };
}

function formatMessage(format: string, args: unknown[]): string {
  if (args.length === 0) return format;

  let result = format;
  for (const arg of args) {
    result = result.replace(/%[sdvxo]/, String(arg));
  }
  return result;
}
