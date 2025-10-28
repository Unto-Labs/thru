import { Transaction } from "./Transaction";
import type { BuildTransactionParams, SignedTransactionResult, TransactionAccountsInput } from "./types";
import { normalizeAccountList, resolveProgramIdentifier } from "./utils";

const FLAG_HAS_FEE_PAYER_PROOF = 1 << 0;

export class TransactionBuilder {
    build(params: BuildTransactionParams): Transaction {
        const program = resolveProgramIdentifier(params.program);
        const accounts = this.normalizeAccounts(params.accounts);
        const instructions = params.content?.instructions;
        const proofs = params.content?.proofs;
        const baseFlags = params.header.flags ?? 0;
        const flags = proofs?.feePayerStateProof ? baseFlags | FLAG_HAS_FEE_PAYER_PROOF : baseFlags;

        return new Transaction({
            feePayer: params.feePayer.publicKey,
            program,
            header: {
                ...params.header,
                flags,
            },
            accounts,
            instructions,
            proofs,
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

    private normalizeAccounts(accounts?: TransactionAccountsInput): TransactionAccountsInput | undefined {
        if (!accounts) {
            return undefined;
        }
        return {
            readWriteAccounts: normalizeAccountList(accounts.readWriteAccounts ?? []),
            readOnlyAccounts: normalizeAccountList(accounts.readOnlyAccounts ?? []),
        };
    }
}
