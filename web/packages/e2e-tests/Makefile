# Thru Network E2E Test Suite Makefile

# Configuration
SEND_BLOCK_PATH ?= ../../../grpc/send-block
BASE_URL ?= http://127.0.0.1:8472
BLOCKBUILDER ?= 127.0.0.1:9002
GRPC_ENDPOINT ?= 127.0.0.1:8472
CHAIN_ID ?= 1
TIMEOUT ?= 300000
CONCURRENCY ?= 1
SEED ?= 0
SCENARIO ?=

# Common flags
E2E_FLAGS = --send-block-path $(SEND_BLOCK_PATH) \
            --base-url $(BASE_URL) \
            --blockbuilder $(BLOCKBUILDER) \
            --grpc $(GRPC_ENDPOINT) \
            --chain-id $(CHAIN_ID) \
            --timeout $(TIMEOUT) \
            --concurrency $(CONCURRENCY)

ifneq ($(SEED),0)
E2E_FLAGS += --seed $(SEED)
endif

# All scenario names (underscore form, matching run-e2e.ts)
SCENARIOS = basic_rpc balance_transfer send_and_track_txn \
            list_transactions list_accounts list_blocks \
            stream_blocks fee_payer_seq_increment slot_metrics \
            transaction_status list_transactions_for_account \
            eoa_account_creation transaction_filters \
            account_creation_fee_payer_failure raw_and_get_methods \
            get_state_roots account_updates_filters account_resize \
            event_emission uploader_program manager_program \
            intra_block_seq_tracking decompress_huge decompress_huge_16mb \
            account_shrink_bug chain_info node_info \
            batch_send_transactions send_and_track_combined \
            stream_slot_metrics stream_node_records \
            get_and_list_events stream_error_paths

# Generate test-<name> targets from scenario list
SCENARIO_TARGETS = $(addprefix test-,$(subst _,-,$(SCENARIOS)))

.PHONY: help build clean test test-verbose test-fail-fast test-scenario \
        list-scenarios check-send-block install $(SCENARIO_TARGETS)

# Default target
help:
	@echo "Thru Network E2E Test Suite"
	@echo ""
	@echo "Usage:"
	@echo "  make test                    Run all tests"
	@echo "  make test-verbose            Run all tests with verbose output"
	@echo "  make test-fail-fast          Run tests, stop on first failure"
	@echo "  make test SCENARIO=name      Run a specific scenario"
	@echo "  make list-scenarios          List all available scenarios"
	@echo ""
	@echo "Build targets:"
	@echo "  make build                   Build the test suite"
	@echo "  make clean                   Clean build artifacts"
	@echo "  make install                 Install dependencies"
	@echo ""
	@echo "Configuration (via environment variables):"
	@echo "  SEND_BLOCK_PATH    Path to send-block binary (default: ../../../grpc/send-block)"
	@echo "  BASE_URL           gRPC-Web endpoint (default: http://127.0.0.1:8472)"
	@echo "  BLOCKBUILDER       Block builder BTP endpoint (default: 127.0.0.1:9002)"
	@echo "  GRPC_ENDPOINT      gRPC endpoint (default: 127.0.0.1:8472)"
	@echo "  CHAIN_ID           Chain ID for transactions (default: 1)"
	@echo "  TIMEOUT            Test timeout in ms (default: 300000)"
	@echo "  CONCURRENCY        Max concurrent tests (default: 1)"
	@echo "  SEED               Random seed for reproducibility (default: 0 = random)"
	@echo "  SCENARIO           Specific scenario to run"
	@echo ""
	@echo "Per-scenario targets (run 'make list-scenarios' for full list):"
	@echo "  make test-basic-rpc              Run basic_rpc scenario"
	@echo "  make test-balance-transfer       Run balance_transfer scenario"
	@echo "  make test-stream-blocks          Run stream_blocks scenario"
	@echo "  ...                              (one target per scenario)"
	@echo ""
	@echo "Examples:"
	@echo "  make test                              # Run all tests"
	@echo "  make test SCENARIO=basic_rpc           # Run basic_rpc test only"
	@echo "  make test-verbose SCENARIO=balance_transfer"
	@echo "  make test SEED=12345                   # Reproducible run"

# Build the test suite (and workspace dependencies)
build:
	cd ../proto && pnpm exec tsup
	cd ../helpers && pnpm exec tsup
	cd ../crypto && pnpm exec tsup
	cd ../thru-sdk && pnpm exec tsup
	pnpm build

# Clean build artifacts
clean:
	pnpm clean

# Install dependencies
install:
	pnpm install

# Check if send-block binary exists
check-send-block:
	@if [ ! -f "$(SEND_BLOCK_PATH)" ]; then \
		echo "Error: send-block binary not found at $(SEND_BLOCK_PATH)"; \
		echo "Build it with: cd grpc && go build -o send-block ./cmd/send-block"; \
		exit 1; \
	fi

# Run all tests
test: check-send-block
ifdef SCENARIO
	pnpm e2e $(SCENARIO) $(E2E_FLAGS)
else
	pnpm e2e $(E2E_FLAGS)
endif

# Run tests with verbose output
test-verbose: check-send-block
ifdef SCENARIO
	pnpm e2e $(SCENARIO) $(E2E_FLAGS) --verbose
else
	pnpm e2e $(E2E_FLAGS) --verbose
endif

# Run tests with fail-fast
test-fail-fast: check-send-block
ifdef SCENARIO
	pnpm e2e $(SCENARIO) $(E2E_FLAGS) --fail-fast --verbose
else
	pnpm e2e $(E2E_FLAGS) --fail-fast --verbose
endif

# Run a specific scenario (convenience target)
test-scenario: check-send-block
ifndef SCENARIO
	$(error SCENARIO is required. Usage: make test-scenario SCENARIO=basic_rpc)
endif
	pnpm e2e $(SCENARIO) $(E2E_FLAGS) --verbose

# List all available scenarios
list-scenarios:
	@echo "Available scenarios:"
	@echo ""
	@echo "Core Tests:"
	@echo "  basic_rpc                         - GetHeight, GetVersion, GetAccount"
	@echo "  balance_transfer                  - Full transfer with streaming verification"
	@echo "  send_and_track_txn                - TrackTransaction streaming"
	@echo ""
	@echo "Pagination Tests:"
	@echo "  list_transactions                 - Transaction pagination and filters"
	@echo "  list_accounts                     - Account pagination and filters"
	@echo "  list_blocks                       - Block listing with pagination"
	@echo ""
	@echo "Streaming Tests:"
	@echo "  stream_blocks                     - Block streaming with filters"
	@echo "  account_updates_filters           - Filtered account streams"
	@echo ""
	@echo "Account Tests:"
	@echo "  eoa_account_creation              - EOA account creation"
	@echo "  account_creation_fee_payer_failure - Invalid proof handling"
	@echo "  account_resize                    - Create/grow/shrink in same block"
	@echo "  account_shrink_bug                - COW pages bug test"
	@echo ""
	@echo "Transaction Tests:"
	@echo "  transaction_status                - GetTransactionStatus API"
	@echo "  transaction_filters               - Filtered transaction streams"
	@echo "  fee_payer_seq_increment           - Sequence number tracking"
	@echo "  list_transactions_for_account     - Account transaction listing"
	@echo ""
	@echo "State Tests:"
	@echo "  get_state_roots                   - State root verification"
	@echo "  raw_and_get_methods               - Raw API methods"
	@echo "  slot_metrics                      - Slot metrics API"
	@echo "  intra_block_seq_tracking          - Historical state via seq"
	@echo ""
	@echo "Program Tests:"
	@echo "  uploader_program                  - Uploader program operations"
	@echo "  manager_program                   - Manager program (8 instructions)"
	@echo "  event_emission                    - Event emission and streaming"
	@echo ""
	@echo "Compression Tests:"
	@echo "  decompress_huge                   - 1MB compression/decompression"
	@echo "  decompress_huge_16mb              - 16MB compression/decompression (slow)"
	@echo ""
	@echo "Info Tests:"
	@echo "  chain_info                        - Chain info API"
	@echo "  node_info                         - Node info API"
	@echo ""
	@echo "Batch/Combined Tests:"
	@echo "  batch_send_transactions           - Batch transaction sending"
	@echo "  send_and_track_combined           - Combined send and track"
	@echo ""
	@echo "Additional Streaming Tests:"
	@echo "  stream_slot_metrics               - Slot metrics streaming"
	@echo "  stream_node_records               - Node records streaming"
	@echo ""
	@echo "Event Tests:"
	@echo "  get_and_list_events               - Event query APIs"
	@echo ""
	@echo "Error Path Tests:"
	@echo "  stream_error_paths                - Stream error handling paths"

# Per-scenario targets: make test-<scenario-with-hyphens>
# Generated from SCENARIOS list — underscores become hyphens in target names.
# e.g. make test-basic-rpc, make test-balance-transfer, make test-stream-blocks
define SCENARIO_TARGET
test-$(subst _,-,$(1)): check-send-block
	pnpm e2e $(1) $$(E2E_FLAGS) --verbose
endef
$(foreach s,$(SCENARIOS),$(eval $(call SCENARIO_TARGET,$(s))))