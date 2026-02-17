# @thru/e2e-tests

End-to-end test suite for the Thru Network, testing the `@thru/thru-sdk` against a running thru node.

## Prerequisites

1. **Running Thru Node**: Start a local thru node with `tndev dev`
2. **send-block Binary**: Build the Go `send-block` binary for block submission

```bash
# Build send-block binary
cd grpc && go build -o send-block ./cmd/send-block
```

## Quick Start

```bash
# Run all tests
make test

# Run a specific test
make test SCENARIO=basic_rpc

# Run with verbose output
make test-verbose
```

## CLI Usage

```bash
# Run all tests
pnpm e2e --send-block-path /path/to/send-block

# Run a specific scenario
pnpm e2e basic_rpc --send-block-path /path/to/send-block

# Run with verbose output
pnpm e2e --verbose --send-block-path /path/to/send-block

# Run with custom endpoints
pnpm e2e --base-url http://localhost:8472 --blockbuilder 127.0.0.1:11237

# Run with deterministic seed (reproducible)
pnpm e2e --seed 12345

# Stop on first failure
pnpm e2e --fail-fast
```

## CLI Options

| Option | Default | Description |
|--------|---------|-------------|
| `--base-url <url>` | `http://127.0.0.1:8472` | gRPC-Web endpoint |
| `--blockbuilder <endpoint>` | `127.0.0.1:11237` | Block builder UDP endpoint |
| `--producer-key <hex>` | (auto-generated) | Block producer private key (hex) |
| `--send-block-path <path>` | `./send-block` | Path to send-block binary |
| `--grpc <endpoint>` | `127.0.0.1:8472` | gRPC endpoint for send-block |
| `--concurrency <n>` | `1` | Maximum concurrent tests |
| `--fail-fast` | `false` | Stop on first test failure |
| `--verbose` | `false` | Enable verbose output |
| `--seed <n>` | `0` (random) | Random seed for deterministic runs |
| `--timeout <ms>` | `300000` | Test timeout in milliseconds |
| `--chain-id <n>` | `1` | Chain ID for transactions |

## Available Scenarios

### Core Tests
| Scenario | Description |
|----------|-------------|
| `basic_rpc` | Tests GetHeight, GetVersion, GetAccount APIs |
| `balance_transfer` | Full transfer with block submission and streaming verification |
| `send_and_track_txn` | TrackTransaction streaming API |

### Pagination Tests
| Scenario | Description |
|----------|-------------|
| `list_transactions` | Pagination and CEL filters for transactions |
| `list_accounts` | Pagination and owner filters for accounts |
| `list_blocks` | Block listing with pagination |

### Streaming Tests
| Scenario | Description |
|----------|-------------|
| `stream_blocks` | Block streaming with CEL filters |
| `account_updates_filters` | Filtered account update streams |

### Account Tests
| Scenario | Description |
|----------|-------------|
| `eoa_account_creation` | EOA account creation with state proofs |
| `account_creation_fee_payer_failure` | Tests invalid proof handling |
| `account_resize` | Create/grow/shrink account in same block |
| `account_shrink_bug` | COW pages bug test (alias of account_resize) |

### Transaction Tests
| Scenario | Description |
|----------|-------------|
| `transaction_status` | GetTransactionStatus API |
| `transaction_filters` | Filtered transaction streams |
| `fee_payer_seq_increment` | Fee payer sequence number tracking |
| `list_transactions_for_account` | Account-specific transaction listing |

### State Tests
| Scenario | Description |
|----------|-------------|
| `get_state_roots` | State root retrieval and verification |
| `raw_and_get_methods` | GetRawAccount, GetRawTransaction, GetRawBlock |
| `slot_metrics` | Slot metrics API |
| `intra_block_seq_tracking` | Historical state queries via seq numbers |

### Program Tests
| Scenario | Description |
|----------|-------------|
| `uploader_program` | Uploader program CREATE/WRITE/FINALIZE/DESTROY |
| `manager_program` | Manager program with all 8 instructions |
| `event_emission` | Event emission and streaming |

### Compression Tests
| Scenario | Description |
|----------|-------------|
| `decompress_huge` | 1MB account compression/decompression cycle |
| `decompress_huge_16mb` | 16MB account compression/decompression cycle (slow) |

## Architecture

```
src/
├── cli/
│   └── run-e2e.ts           # CLI entry point
├── framework/
│   ├── executor.ts          # Test executor with parallel support
│   ├── scenario.ts          # BaseScenario interface
│   ├── context.ts           # TestContext with SDK and helpers
│   ├── config.ts            # TestConfig interface
│   └── result.ts            # TestResult interface
├── accounts/
│   ├── genesis-pool.ts      # GenesisAccountPool (1024 accounts)
│   └── genesis-account.ts   # Genesis account derivation
├── block/
│   └── block-sender.ts      # Spawns send-block process
├── state/
│   └── account-tracker.ts   # Account state tracking via streaming
├── programs/
│   ├── constants.ts         # Program pubkeys
│   ├── system.ts            # System program instructions
│   ├── test-uploader.ts     # TestUploader program instructions
│   ├── uploader.ts          # Uploader program instructions
│   ├── manager.ts           # Manager program instructions
│   └── event.ts             # Event program instructions
└── scenarios/
    └── *.ts                 # Individual test scenarios
```

## Writing New Scenarios

Create a new file in `src/scenarios/`:

```typescript
import { BaseScenario } from "../framework/scenario";
import type { TestContext } from "../framework/context";
import type { TestResult } from "../framework/result";

export class MyScenario extends BaseScenario {
  name = "My Scenario";
  description = "Description of what this tests";

  async setup(ctx: TestContext): Promise<void> {
    // Setup code (acquire accounts, subscribe to streams, etc.)
  }

  async execute(ctx: TestContext): Promise<TestResult> {
    // Test logic
    return {
      success: true,
      message: "Test passed",
      details: [],
      verificationDetails: [],
      executionTimeMs: 0,
    };
  }

  async cleanup(ctx: TestContext): Promise<void> {
    // Cleanup code (release accounts, unsubscribe, etc.)
  }
}

export function createMyScenario(): MyScenario {
  return new MyScenario();
}
```

Then register it in `src/cli/run-e2e.ts`:

1. Add import: `import { createMyScenario } from "../scenarios";`
2. Add to `getScenarioByName()` map
3. Add to `getScenarioNames()` array
4. Add to `registerAllScenarios()` function

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Run in development mode
pnpm dev

# Run unit tests
pnpm test
```

## Docker Development

For Docker-based development with `tndev` and `thrud`:

```bash
# Start services
./contrib/docker-dev/dev.sh start

# Run e2e tests against Docker services
pnpm e2e --send-block-path ../../grpc/send-block

# Stop services
./contrib/docker-dev/dev.sh stop
```

## Troubleshooting

### "send-block not found"
Build the send-block binary:
```bash
cd grpc && go build -o send-block ./cmd/send-block
```

### "Connection refused"
Ensure `tndev dev` is running and listening on the expected ports.

### "Transaction timeout"
- Check that the block builder is accepting blocks
- Verify the producer key has signing authority
- Increase `--timeout` if needed

### "Invalid state proof"
State proofs expire quickly. The test framework handles this automatically, but if you see failures, ensure the node is producing blocks consistently.
