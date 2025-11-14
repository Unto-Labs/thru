import { Transaction } from "./Transaction";
import type {
    BuildTransactionParams,
    SignedTransactionResult,
    TransactionAccountsInput,
} from "./types";
import { normalizeAccountList, parseInstructionData, resolveProgramIdentifier } from "./utils";

const FLAG_HAS_FEE_PAYER_PROOF = 1 << 0;

export class TransactionBuilder {
    build(params: BuildTransactionParams): Transaction {
        const program = resolveProgramIdentifier(params.program);
        const accounts = this.normalizeAccounts(params.accounts);
        const baseFlags = params.header.flags ?? 0;
        const flags = params.proofs?.feePayerStateProof ? baseFlags | FLAG_HAS_FEE_PAYER_PROOF : baseFlags;

        /* Parse instruction data from BytesLike */
        const instructionData = parseInstructionData(params.instructionData);

        return new Transaction({
            feePayer: params.feePayer.publicKey,
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

    private normalizeAccounts(accounts?: TransactionAccountsInput): TransactionAccountsInput | undefined {
        if (!accounts) {
            return undefined;
        }
        return {
            readWriteAccounts: normalizeAccountList(accounts.readWriteAccounts ?? []),
            readOnlyAccounts: normalizeAccountList(accounts.readOnlyAccounts ?? []),
        };
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
