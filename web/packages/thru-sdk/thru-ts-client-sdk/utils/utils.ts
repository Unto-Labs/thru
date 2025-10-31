import { BytesLike } from "@thru/helpers";

import { TransactionHeaderInput } from "../transactions";

export type BlockSelector = { slot: number | bigint } | { blockHash: BytesLike };

export function isSlotSelector(selector: BlockSelector): selector is { slot: number | bigint } {
    return "slot" in selector;
}

export function mergeTransactionHeader(
    defaults: TransactionHeaderInput,
    overrides?: Partial<TransactionHeaderInput>,
): TransactionHeaderInput {
    if (!overrides) {
        return defaults;
    }

    const sanitized = Object.fromEntries(
        Object.entries(overrides).filter(([, value]) => value !== undefined),
    ) as Partial<TransactionHeaderInput>;

    return {
        ...defaults,
        ...sanitized,
    };
}
