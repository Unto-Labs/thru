import { create } from "@bufbuild/protobuf";

import type { ThruClientContext } from "../core/client";
import { withCallOptions } from "../core/client";
import { Signature, type SignatureInput } from "../domain/primitives";
import {
    DebugReExecuteRequestSchema,
    type CallFrame,
    type DebugReExecuteResponse,
    type VmExecutionDetails,
} from "@thru/sdk/proto";

export interface ReExecuteTransactionOptions {
    /** Account snapshots before execution. */
    includeStateBefore?: boolean;
    /** Account snapshots after execution. */
    includeStateAfter?: boolean;
    /** Account data in the snapshots (otherwise metadata only). */
    includeAccountData?: boolean;
    /** Every allocated stack and heap page. */
    includeMemoryDump?: boolean;
    signal?: AbortSignal;
}

/**
 * Re-executes a stored transaction against its historical account state
 * (`DebugService.DebugReExecute`) and returns the VM's state at halt, program
 * stdout and log, and an instruction trace.
 *
 * The node needs the debug service enabled; otherwise the call fails with
 * `Code.Unimplemented`. It fails with `Code.NotFound` when the transaction or
 * the account data it needs is not indexed. Public RPCs weigh this call
 * heavily against the rate limit.
 */
export async function reExecuteTransaction(
    ctx: ThruClientContext,
    signature: SignatureInput,
    options: ReExecuteTransactionOptions = {},
): Promise<DebugReExecuteResponse> {
    const request = create(DebugReExecuteRequestSchema, {
        signature: Signature.from(signature).toProtoSignature(),
        includeStateBefore: options.includeStateBefore ?? false,
        includeStateAfter: options.includeStateAfter ?? false,
        includeAccountData: options.includeAccountData ?? false,
        includeMemoryDump: options.includeMemoryDump ?? false,
    });
    return ctx.debug.debugReExecute(
        request,
        withCallOptions(ctx, options.signal ? { signal: options.signal } : undefined),
    );
}

/**
 * The call frames live at halt, root first, failing frame last. Drops frame
 * 0, the VM's all-zero sentinel, and anything past `callDepth`. Frames that
 * had already returned are not recorded by the VM.
 */
export function callStack(details: VmExecutionDetails | undefined): CallFrame[] {
    if (!details) return [];
    const depth = Number(details.callDepth);
    return details.callFrames.slice(1, depth + 1);
}
