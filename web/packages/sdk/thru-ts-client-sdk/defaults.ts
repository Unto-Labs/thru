import { create } from "@bufbuild/protobuf";

import {
    ConsensusStatus,
    CurrentVersionSchema,
    VersionContextSchema,
    AccountView,
    BlockView,
    TransactionView
} from "@thru/sdk/proto";

export const DEFAULT_HOST = "https://rpc.alphanet.thru.org";

export const DEFAULT_ACCOUNT_VIEW = AccountView.FULL;
export const DEFAULT_BLOCK_VIEW = BlockView.FULL;
export const DEFAULT_TRANSACTION_VIEW = TransactionView.FULL;
export const DEFAULT_MIN_CONSENSUS = ConsensusStatus.UNSPECIFIED;
export const DEFAULT_VERSION_CONTEXT = create(VersionContextSchema, {
    version: {
        case: "current",
        value: create(CurrentVersionSchema, {}),
    },
});

export const DEFAULT_FEE = 1n;
export const DEFAULT_COMPUTE_UNITS = 0;
export const DEFAULT_STATE_UNITS = 0;
export const DEFAULT_MEMORY_UNITS = 0;
export const DEFAULT_EXPIRY_AFTER = 100;

/**
 * Resource budget for `accounts.create` (a fee-payer-created account on the
 * Noop program with a CREATING state proof). Matches the Rust builder
 * `build_create_with_fee_payer_proof` (`rpc/thru-base/src/txn_tools.rs`) used
 * by the CLI. A zero budget is rejected by the runtime (vmError -497).
 */
export const DEFAULT_CREATE_ACCOUNT_COMPUTE_UNITS = 10_000;
export const DEFAULT_CREATE_ACCOUNT_MEMORY_UNITS = 10_000;
export const DEFAULT_CREATE_ACCOUNT_STATE_UNITS = 1;
