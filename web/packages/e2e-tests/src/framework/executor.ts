import type { TestConfig } from "./config";

// We use 'any' for SDK types to avoid tight coupling to thru-sdk internals
// The actual SDK will be dynamically imported
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ThruSdk = any;
import type { TestScenario } from "./scenario";
import type { TestResult } from "./result";
import { createTestContext, E2ELogger } from "./context";
import { GenesisAccountPool } from "../accounts";
import { BlockSender } from "../block";
import { AccountStateTracker } from "../state";
import { SeededRNG, randomHexBytes } from "../utils";

export interface ScenarioResult {
  name: string;
  result: TestResult;
}

export class TestExecutor {
  private config: TestConfig;
  private accountPool: GenesisAccountPool;
  private scenarios: TestScenario[] = [];
  private results: ScenarioResult[] = [];
  private blockSender: BlockSender | null = null;
  private stateTracker: AccountStateTracker | null = null;
  private rng: SeededRNG;
  private sdk: ThruSdk | null = null;

  constructor(config: TestConfig) {
    this.config = config;
    this.accountPool = new GenesisAccountPool();
    this.rng = new SeededRNG(config.seed);

    // Generate random block producer key if not provided
    if (!this.config.producerKey) {
      this.config.producerKey = randomHexBytes(this.rng, 32);
      console.log(`Generated random block producer key: ${this.config.producerKey}`);
    }
  }

  registerScenario(scenario: TestScenario): void {
    this.scenarios.push(scenario);
  }

  registerScenarios(scenarios: TestScenario[]): void {
    this.scenarios.push(...scenarios);
  }

  async run(signal: AbortSignal): Promise<ScenarioResult[]> {
    if (this.scenarios.length === 0) {
      throw new Error("No test scenarios registered");
    }

    // Initialize genesis account pool (computes Ed25519 keys)
    await this.accountPool.initialize();

    console.log(`Starting execution of ${this.scenarios.length} test scenarios (max concurrency: ${this.config.maxConcurrency})`);
    console.log(`Genesis accounts available: ${this.accountPool.availableCount()}`);

    const suiteStartTime = Date.now();

    // Create SDK client with native gRPC transport for Node.js
    // The SDK's default gRPC-Web transport doesn't work with native gRPC servers
    const { createGrpcTransport } = await import("@connectrpc/connect-node");
    const { createThruClient } = await import("@thru/thru-sdk/client");

    const transport = createGrpcTransport({
      baseUrl: this.config.baseUrl,
    });

    this.sdk = createThruClient({ transport });

    // Initialize block sender
    this.blockSender = new BlockSender({
      sendBlockPath: this.config.sendBlockPath,
      producerKey: this.config.producerKey,
      target: this.config.blockBuilderEndpoint,
      grpcEndpoint: this.config.grpcEndpoint,
      chainId: this.config.chainId,
      verbose: this.config.verbose,
      waitForVote: this.config.waitForVote,
      voteTimeoutMs: this.config.voteTimeoutMs,
      sequencerMode: this.config.sequencerMode,
    });

    // Seed block sender's local slot counter from current finalized height.
    // This avoids duplicate start_slot when sending blocks faster than finalization.
    const height = await this.sdk.blocks.getBlockHeight();
    this.blockSender.seedSlot(height.finalized);

    // Initialize account state tracker
    this.stateTracker = new AccountStateTracker(this.sdk, this.config.chainId);
    await this.stateTracker.setup();

    try {
      // Execute scenarios with concurrency control
      const semaphore = new Semaphore(this.config.maxConcurrency);
      const promises: Promise<void>[] = [];
      let executionError: Error | null = null;

      for (const scenario of this.scenarios) {
        if (signal.aborted) break;
        if (this.config.failFast && executionError) break;

        const promise = semaphore.acquire().then(async () => {
          try {
            const result = await this.runScenario(scenario, signal);
            this.results.push(result);

            if (result.result.success) {
              console.log(`✓ ${result.name} (${(result.result.executionTimeMs / 1000).toFixed(2)}s)`);
            } else {
              console.log(`✗ ${result.name} (${(result.result.executionTimeMs / 1000).toFixed(2)}s): ${result.result.message}`);
              if (this.config.failFast && !executionError) {
                executionError = new Error(`Test failed: ${result.name}`);
              }
            }
          } finally {
            semaphore.release();
          }
        });

        promises.push(promise);
      }

      await Promise.all(promises);

      // Print summary
      const suiteExecutionTime = Date.now() - suiteStartTime;
      this.printSummary(suiteExecutionTime);

      const failedCount = this.results.filter((r) => !r.result.success).length;
      if (failedCount > 0) {
        throw new Error(`${failedCount} test(s) failed`);
      }

      return this.results;
    } finally {
      this.stateTracker?.cleanup();
    }
  }

  private async runScenario(scenario: TestScenario, signal: AbortSignal): Promise<ScenarioResult> {
    const startTime = Date.now();
    const scenarioName = scenario.name;

    // Acquire genesis account
    const account = this.accountPool.acquire();
    if (!account) {
      return {
        name: scenarioName,
        result: {
          success: false,
          message: "Failed to acquire genesis account from pool",
          details: [],
          verificationDetails: [],
          executionTimeMs: Date.now() - startTime,
        },
      };
    }

    try {
      const logger = new E2ELogger(scenarioName, this.config.verbose);

      // Create abort controller for this test with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort(new Error(`Test timeout after ${this.config.testTimeoutMs}ms`));
      }, this.config.testTimeoutMs);

      // Link parent signal
      const abortHandler = () => controller.abort(signal.reason);
      signal.addEventListener("abort", abortHandler);

      try {
        const ctx = createTestContext(
          this.sdk!,
          account,
          this.accountPool,
          this.config,
          this.rng,
          this.blockSender!,
          this.stateTracker!,
          logger,
          controller.signal
        );

        // Run setup phase
        await scenario.setup(ctx);

        // Wait for execution sync before running test
        await this.stateTracker!.waitForExecution(this.config.testTimeoutMs);

        // Run execute phase
        const result = await scenario.execute(ctx);

        // Run cleanup phase
        try {
          await scenario.cleanup(ctx);
        } catch (cleanupErr) {
          result.details.push(`cleanup warning: ${cleanupErr}`);
        }

        result.executionTimeMs = Date.now() - startTime;
        return { name: scenarioName, result };
      } finally {
        clearTimeout(timeoutId);
        signal.removeEventListener("abort", abortHandler);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        name: scenarioName,
        result: {
          success: false,
          message: `Execution failed: ${errorMessage}`,
          details: [],
          verificationDetails: [],
          executionTimeMs: Date.now() - startTime,
        },
      };
    } finally {
      this.accountPool.release(account);
    }
  }

  private printSummary(suiteExecutionTime: number): void {
    const separator = "=".repeat(80);
    console.log("\n" + separator);
    console.log("Test Suite Summary");
    console.log(separator);

    const passedCount = this.results.filter((r) => r.result.success).length;
    const failedCount = this.results.length - passedCount;

    console.log(`Total Tests:     ${this.results.length}`);
    console.log(`Passed:          ${passedCount}`);
    console.log(`Failed:          ${failedCount}`);
    console.log(`Suite Time:      ${(suiteExecutionTime / 1000).toFixed(2)}s`);
    console.log(separator);

    if (failedCount > 0) {
      console.log("\nFailed Tests:");
      for (const result of this.results) {
        if (!result.result.success) {
          console.log(`  - ${result.name}: ${result.result.message}`);
          for (const detail of result.result.details) {
            console.log(`    - ${detail}`);
          }
        }
      }
    }
  }
}

/**
 * Simple semaphore for concurrency control
 */
class Semaphore {
  private permits: number;
  private waitQueue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  release(): void {
    const next = this.waitQueue.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }
}
