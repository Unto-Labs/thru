import { create } from "@bufbuild/protobuf";

import { ConsensusStatus, CurrentVersionSchema, VersionContextSchema } from "./proto/thru/common/v1/consensus_pb";
import { AccountView } from "./proto/thru/core/v1/account_pb";
import { BlockView } from "./proto/thru/core/v1/block_pb";
import { TransactionView } from "./proto/thru/core/v1/transaction_pb";

export const DEFAULT_HOST = "https://grpc-web.alphanet.thruput.org";

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
export const DEFAULT_COMPUTE_UNITS = 300_000_000;
export const DEFAULT_STATE_UNITS = 10_000;
export const DEFAULT_MEMORY_UNITS = 10_000;
export const DEFAULT_EXPIRY_AFTER = 100;
