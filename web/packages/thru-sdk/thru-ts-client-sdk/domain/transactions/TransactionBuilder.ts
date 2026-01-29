import { Pubkey } from "../primitives";
import { Transaction } from "./Transaction";
import type {
    BuildTransactionParams,
    SignedTransactionResult,
    TransactionAccountsInput,
} from "./types";
import { createInstructionContext, normalizeAccountList, parseInstructionData } from "./utils";

const FLAG_HAS_FEE_PAYER_PROOF = 1 << 0;

export class TransactionBuilder {
    build(params: BuildTransactionParams): Transaction {
        const feePayer = Pubkey.from(params.feePayer.publicKey);
        const program = Pubkey.from(params.program);

        // Normalize accounts first (sort and dedupe)
        const sortedReadWrite = normalizeAccountList(params.accounts?.readWriteAccounts ?? []);
        const sortedReadOnly = normalizeAccountList(params.accounts?.readOnlyAccounts ?? []);

        // Resolve instruction data - either from callback or static value
        let instructionData: Uint8Array | undefined;

        if (params.buildInstructionData) {
            const context = createInstructionContext(feePayer, program, sortedReadWrite, sortedReadOnly);
            const result = params.buildInstructionData(context);
            instructionData = parseInstructionData(result);
        } else {
            instructionData = parseInstructionData(params.instructionData);
        }

        const baseFlags = params.header.flags ?? 0;
        const flags = params.proofs?.feePayerStateProof ? baseFlags | FLAG_HAS_FEE_PAYER_PROOF : baseFlags;

        // Build normalized accounts object
        const accounts: TransactionAccountsInput | undefined =
            sortedReadWrite.length > 0 || sortedReadOnly.length > 0
                ? { readWriteAccounts: sortedReadWrite, readOnlyAccounts: sortedReadOnly }
                : undefined;

        return new Transaction({
            feePayer,
            program,
            header: {
                ...params.header,
                flags,
            },
            accounts,
            instructionData,
            proofs: params.proofs,
        });
    }

    async buildAndSign(params: BuildTransactionParams): Promise<SignedTransactionResult> {
        if (!params.feePayer.privateKey) {
            throw new Error("Fee payer private key is required to sign the transaction");
        }
        const transaction = this.build(params);
        const signature = await transaction.sign(params.feePayer.privateKey);
        const rawTransaction = transaction.toWire();
        return { transaction, signature, rawTransaction };
    }
}
