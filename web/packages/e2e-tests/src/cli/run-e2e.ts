#!/usr/bin/env node

import { Command } from "commander";
import { TestExecutor, defaultTestConfig, DEFAULT_BTP_ENDPOINT, DEFAULT_BPROT_ENDPOINT } from "../framework";
import {
  createBasicRPCScenario,
  createBalanceTransferScenario,
  createSendAndTrackTxnScenario,
  createListTransactionsScenario,
  createListAccountsScenario,
  createListBlocksScenario,
  createStreamBlocksScenario,
  createFeePayerSeqIncrementScenario,
  createSlotMetricsScenario,
  createTransactionStatusScenario,
  createListTransactionsForAccountScenario,
  createEOAAccountCreationScenario,
  createTransactionFiltersScenario,
  createAccountCreationFeePayerFailureScenario,
  createRawAndGetMethodsScenario,
  createGetStateRootsScenario,
  createAccountUpdatesFiltersScenario,
  createAccountResizeScenario,
  createEventEmissionScenario,
  createUploaderProgramScenario,
  createManagerProgramScenario,
  createIntraBlockSeqTrackingScenario,
  createDecompressHugeScenario,
  createDecompressHuge16MBScenario,
  createAccountShrinkBugScenario,
  createChainInfoScenario,
  createNodeInfoScenario,
  createBatchSendTransactionsScenario,
  createSendAndTrackCombinedScenario,
  createStreamSlotMetricsScenario,
  createStreamNodeRecordsScenario,
  createGetAndListEventsScenario,
  createStreamErrorPathsScenario,
  createErrorProgramAccIdxScenario,
  createDebugReExecuteScenario,
} from "../scenarios";
import type { TestScenario } from "../framework/scenario";

const program = new Command();

program
  .name("thru-e2e")
  .description("Thru Network TypeScript E2E Test Suite")
  .version("0.0.1")
  .option("--base-url <url>", "gRPC-Web endpoint", "http://127.0.0.1:8472")
  .option("--blockbuilder <endpoint>", "Block builder BTP endpoint", DEFAULT_BTP_ENDPOINT)
  .option("--producer-key <hex>", "Block producer private key (hex)")
  .option("--send-block-path <path>", "Path to send-block binary", "./send-block")
  .option("--grpc <endpoint>", "gRPC endpoint for send-block", "127.0.0.1:8472")
  .option("--concurrency <n>", "Maximum concurrent tests", "1")
  .option("--fail-fast", "Stop on first test failure", false)
  .option("--verbose", "Enable verbose output", false)
  .option("--seed <n>", "Random seed for deterministic runs", "0")
  .option("--timeout <ms>", "Test timeout in milliseconds", "300000")
  .option("--chain-id <n>", "Chain ID for transactions", "1")
  .option("--wait-for-vote", "Wait for consensus vote before sending next block", false)
  .option("--vote-timeout <ms>", "Timeout in ms waiting for vote per block", "30000")
  .option("--sequencer-mode", "Use bprot protocol for block submission", false)
  .argument("[scenario]", "Specific scenario to run (optional)")
  .action(async (scenario: string | undefined, options) => {
    // Generate random seed if not provided
    let seed = BigInt(options.seed);
    if (seed === 0n) {
      seed = BigInt(Date.now()) * BigInt(Math.floor(Math.random() * 1000000));
    }
    console.log(`Using seed: ${seed}`);

    // Create config
    const config = defaultTestConfig();
    config.baseUrl = options.baseUrl;
    config.blockBuilderEndpoint = options.blockbuilder;
    config.producerKey = options.producerKey || "";
    config.sendBlockPath = options.sendBlockPath;
    config.grpcEndpoint = options.grpc;
    config.maxConcurrency = parseInt(options.concurrency, 10);
    config.failFast = options.failFast;
    config.verbose = options.verbose;
    config.seed = seed;
    config.testTimeoutMs = parseInt(options.timeout, 10);
    config.chainId = parseInt(options.chainId, 10);
    config.waitForVote = options.waitForVote;
    if (config.waitForVote) {
      config.voteTimeoutMs = parseInt(options.voteTimeout, 10);
    }
    config.sequencerMode = options.sequencerMode;
    /* When sequencer mode is on and blockbuilder wasn't explicitly set,
       override to the default bprot port */
    if (config.sequencerMode && options.blockbuilder === DEFAULT_BTP_ENDPOINT) {
      config.blockBuilderEndpoint = DEFAULT_BPROT_ENDPOINT;
    }

    // Validate chain ID
    if (config.chainId === 0) {
      console.error("Error: --chain-id must be non-zero");
      process.exit(1);
    }
    if (config.chainId > 65535) {
      console.error(`Error: --chain-id ${config.chainId} exceeds maximum value 65535`);
      process.exit(1);
    }

    // Create executor
    const executor = new TestExecutor(config);

    // Register scenarios
    if (scenario) {
      const scenarioInstance = getScenarioByName(scenario);
      if (!scenarioInstance) {
        console.error(`Unknown scenario: ${scenario}`);
        console.error("Available scenarios:");
        for (const name of getScenarioNames()) {
          console.error(`  - ${name}`);
        }
        process.exit(1);
      }
      executor.registerScenario(scenarioInstance);
    } else {
      registerAllScenarios(executor);
    }

    // Set up signal handling
    const controller = new AbortController();
    process.on("SIGINT", () => {
      console.log("\nReceived interrupt signal, shutting down...");
      controller.abort();
    });
    process.on("SIGTERM", () => {
      console.log("\nReceived terminate signal, shutting down...");
      controller.abort();
    });

    // Print header
    console.log("╔════════════════════════════════════════════════════════════════╗");
    console.log("║         Thru Network TypeScript E2E Test Suite                 ║");
    console.log("╚════════════════════════════════════════════════════════════════╝");
    console.log();

    try {
      const results = await executor.run(controller.signal);
      console.log(`\n✅ All ${results.length} tests passed!`);
      process.exit(0);
    } catch (err) {
      console.error(`\n❌ Test suite failed: ${err}`);
      process.exit(1);
    }
  });

function getScenarioByName(name: string): TestScenario | null {
  const scenarios: Record<string, () => TestScenario> = {
    basic_rpc: createBasicRPCScenario,
    balance_transfer: createBalanceTransferScenario,
    send_and_track_txn: createSendAndTrackTxnScenario,
    list_transactions: createListTransactionsScenario,
    list_accounts: createListAccountsScenario,
    list_blocks: createListBlocksScenario,
    stream_blocks: createStreamBlocksScenario,
    fee_payer_seq_increment: createFeePayerSeqIncrementScenario,
    slot_metrics: createSlotMetricsScenario,
    transaction_status: createTransactionStatusScenario,
    list_transactions_for_account: createListTransactionsForAccountScenario,
    eoa_account_creation: createEOAAccountCreationScenario,
    transaction_filters: createTransactionFiltersScenario,
    account_creation_fee_payer_failure: createAccountCreationFeePayerFailureScenario,
    raw_and_get_methods: createRawAndGetMethodsScenario,
    get_state_roots: createGetStateRootsScenario,
    account_updates_filters: createAccountUpdatesFiltersScenario,
    account_resize: createAccountResizeScenario,
    event_emission: createEventEmissionScenario,
    uploader_program: createUploaderProgramScenario,
    manager_program: createManagerProgramScenario,
    intra_block_seq_tracking: createIntraBlockSeqTrackingScenario,
    decompress_huge: createDecompressHugeScenario,
    decompress_huge_16mb: createDecompressHuge16MBScenario,
    account_shrink_bug: createAccountShrinkBugScenario,
    chain_info: createChainInfoScenario,
    node_info: createNodeInfoScenario,
    batch_send_transactions: createBatchSendTransactionsScenario,
    send_and_track_combined: createSendAndTrackCombinedScenario,
    stream_slot_metrics: createStreamSlotMetricsScenario,
    stream_node_records: createStreamNodeRecordsScenario,
    get_and_list_events: createGetAndListEventsScenario,
    stream_error_paths: createStreamErrorPathsScenario,
    error_program_acc_idx: createErrorProgramAccIdxScenario,
    debug_reexecute: createDebugReExecuteScenario,
  };

  const factory = scenarios[name];
  return factory ? factory() : null;
}

function getScenarioNames(): string[] {
  return [
    "basic_rpc",
    "balance_transfer",
    "send_and_track_txn",
    "list_transactions",
    "list_accounts",
    "list_blocks",
    "stream_blocks",
    "fee_payer_seq_increment",
    "slot_metrics",
    "transaction_status",
    "list_transactions_for_account",
    "eoa_account_creation",
    "transaction_filters",
    "account_creation_fee_payer_failure",
    "raw_and_get_methods",
    "get_state_roots",
    "account_updates_filters",
    "account_resize",
    "event_emission",
    "uploader_program",
    "manager_program",
    "intra_block_seq_tracking",
    "decompress_huge",
    "decompress_huge_16mb",
    "account_shrink_bug",
    "chain_info",
    "node_info",
    "batch_send_transactions",
    "send_and_track_combined",
    "stream_slot_metrics",
    "stream_node_records",
    "get_and_list_events",
    "stream_error_paths",
    "error_program_acc_idx",
    "debug_reexecute",
  ];
}

function registerAllScenarios(executor: TestExecutor): void {
  // Phase 1 - Core
  executor.registerScenario(createBalanceTransferScenario());
  executor.registerScenario(createSendAndTrackTxnScenario());
  executor.registerScenario(createBasicRPCScenario());

  // Phase 2 - Pagination
  executor.registerScenario(createListTransactionsScenario());
  executor.registerScenario(createListAccountsScenario());
  executor.registerScenario(createListBlocksScenario());

  // Phase 3 - Streaming
  executor.registerScenario(createStreamBlocksScenario());

  // Phase 4 - Additional tests
  executor.registerScenario(createFeePayerSeqIncrementScenario());
  executor.registerScenario(createSlotMetricsScenario());
  executor.registerScenario(createTransactionStatusScenario());
  executor.registerScenario(createListTransactionsForAccountScenario());

  // Phase 5 - Account creation tests
  executor.registerScenario(createEOAAccountCreationScenario());

  // Phase 6 - Filter tests
  executor.registerScenario(createTransactionFiltersScenario());

  // Phase 7 - Failure/edge case tests
  executor.registerScenario(createAccountCreationFeePayerFailureScenario());

  // Phase 8 - Raw/Get API tests
  executor.registerScenario(createRawAndGetMethodsScenario());
  executor.registerScenario(createGetStateRootsScenario());

  // Phase 9 - Account streaming filters (uses block builder)
  executor.registerScenario(createAccountUpdatesFiltersScenario());

  // Phase 10 - System program tests (uses block builder)
  executor.registerScenario(createAccountResizeScenario());

  // Phase 11 - Event emission tests (uses block builder)
  executor.registerScenario(createEventEmissionScenario());

  // Phase 12 - Uploader program tests (uses block builder)
  executor.registerScenario(createUploaderProgramScenario());

  // Phase 13 - Manager program tests (uses block builder)
  executor.registerScenario(createManagerProgramScenario());

  // Phase 14 - Intra-block seq tracking tests (uses block builder)
  executor.registerScenario(createIntraBlockSeqTrackingScenario());

  // Phase 15 - Decompress huge tests (uses block builder)
  executor.registerScenario(createDecompressHugeScenario());

  // Phase 16 - Account shrink bug (COW pages) test (alias of account_resize)
  executor.registerScenario(createAccountShrinkBugScenario());

  // Phase 17 - Chain info and node info
  executor.registerScenario(createChainInfoScenario());
  executor.registerScenario(createNodeInfoScenario());

  // Phase 18 - Batch send and combined send+track
  executor.registerScenario(createBatchSendTransactionsScenario());
  executor.registerScenario(createSendAndTrackCombinedScenario());

  // Phase 19 - Streaming (slot metrics, node records)
  executor.registerScenario(createStreamSlotMetricsScenario());
  executor.registerScenario(createStreamNodeRecordsScenario());

  // Phase 20 - Event queries (uses block builder)
  executor.registerScenario(createGetAndListEventsScenario());

  // Phase 21 - Error path tests
  executor.registerScenario(createStreamErrorPathsScenario());

  // Phase 22 - Verify error_program_acc_idx identifies the faulting program
  executor.registerScenario(createErrorProgramAccIdxScenario());

  // Phase 23 - Debug re-execute tests
  executor.registerScenario(createDebugReExecuteScenario());
}

program.parse();
