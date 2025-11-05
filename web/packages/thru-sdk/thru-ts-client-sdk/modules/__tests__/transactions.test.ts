import { create } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";
import {
  createMockAccount,
  createMockContext,
  createMockHeightResponse,
  generateTestAddress,
  generateTestPubkey,
  generateTestSignature,
  generateTestSignatureString,
} from "../../__tests__/helpers/test-utils";
import { ConsensusStatus } from "../../proto/thru/common/v1/consensus_pb";
import { FilterSchema } from "../../proto/thru/common/v1/filters_pb";
import { PageRequestSchema } from "../../proto/thru/common/v1/pagination_pb";
import { TransactionSchema, TransactionView } from "../../proto/thru/core/v1/transaction_pb";
import { TransactionStatusSchema } from "../../proto/thru/services/v1/query_service_pb";
import { Transaction } from "../../transactions/Transaction";
import type { InstructionContext } from "../../transactions/types";
import {
  batchSendTransactions,
  buildAndSignTransaction,
  buildTransaction,
  getRawTransaction,
  getTransaction,
  getTransactionStatus,
  listTransactionsForAccount,
  sendTransaction,
} from "../transactions";

describe("transactions", () => {
  describe("getTransaction", () => {
    it("should return transaction with valid signature", async () => {
      const ctx = createMockContext();
      const mockTransaction = create(TransactionSchema, {
        signature: { value: generateTestSignature() },
      });
      vi.spyOn(ctx.query, "getTransaction").mockResolvedValue(mockTransaction);
      
      const signature = generateTestSignature();
      const result = await getTransaction(ctx, signature);
      
      expect(result).toBe(mockTransaction);
      expect(ctx.query.getTransaction).toHaveBeenCalledTimes(1);
    });

    it("should accept signature as Uint8Array", async () => {
      const ctx = createMockContext();
      const mockTransaction = create(TransactionSchema, {});
      vi.spyOn(ctx.query, "getTransaction").mockResolvedValue(mockTransaction);
      
      const signature = generateTestSignature();
      await getTransaction(ctx, signature);
      
      const callArgs = (ctx.query.getTransaction as any).mock.calls[0][0];
      expect(callArgs.signature.value).toEqual(signature);
    });

    it("should accept signature as string", async () => {
      const ctx = createMockContext();
      const mockTransaction = create(TransactionSchema, {});
      vi.spyOn(ctx.query, "getTransaction").mockResolvedValue(mockTransaction);
      
      const signatureString = generateTestSignatureString();
      await getTransaction(ctx, signatureString);
      
      const callArgs = (ctx.query.getTransaction as any).mock.calls[0][0];
      expect(callArgs.signature.value.length).toBe(64);
    });

    it("should use default view when not provided", async () => {
      const ctx = createMockContext();
      const mockTransaction = create(TransactionSchema, {});
      vi.spyOn(ctx.query, "getTransaction").mockResolvedValue(mockTransaction);
      
      await getTransaction(ctx, generateTestSignature());
      
      const callArgs = (ctx.query.getTransaction as any).mock.calls[0][0];
      expect(callArgs.view).toBe(TransactionView.FULL);
    });

    it("should use custom view when provided", async () => {
      const ctx = createMockContext();
      const mockTransaction = create(TransactionSchema, {});
      vi.spyOn(ctx.query, "getTransaction").mockResolvedValue(mockTransaction);
      
      await getTransaction(ctx, generateTestSignature(), { view: TransactionView.SIGNATURE_ONLY });
      
      const callArgs = (ctx.query.getTransaction as any).mock.calls[0][0];
      expect(callArgs.view).toBe(TransactionView.SIGNATURE_ONLY);
    });

    it("should use default minConsensus", async () => {
      const ctx = createMockContext();
      const mockTransaction = create(TransactionSchema, {});
      vi.spyOn(ctx.query, "getTransaction").mockResolvedValue(mockTransaction);
      
      await getTransaction(ctx, generateTestSignature());
      
      const callArgs = (ctx.query.getTransaction as any).mock.calls[0][0];
      expect(callArgs.minConsensus).toBe(ConsensusStatus.UNSPECIFIED);
    });
  });

  describe("getRawTransaction", () => {
    it("should return raw transaction", async () => {
      const ctx = createMockContext();
      const mockRawTransaction = {
        signature: { value: generateTestSignature() },
        rawTransaction: new Uint8Array([1, 2, 3]),
      };
      vi.spyOn(ctx.query, "getRawTransaction").mockResolvedValue(mockRawTransaction as any);
      
      const signature = generateTestSignature();
      const result = await getRawTransaction(ctx, signature);
      
      expect(result).toBe(mockRawTransaction);
      expect(ctx.query.getRawTransaction).toHaveBeenCalledTimes(1);
    });

    it("should use default version context and minConsensus", async () => {
      const ctx = createMockContext();
      const mockRawTransaction = { signature: { value: generateTestSignature() } };
      vi.spyOn(ctx.query, "getRawTransaction").mockResolvedValue(mockRawTransaction as any);
      
      await getRawTransaction(ctx, generateTestSignature());
      
      const callArgs = (ctx.query.getRawTransaction as any).mock.calls[0][0];
      expect(callArgs.versionContext).toBeDefined();
      expect(callArgs.minConsensus).toBe(ConsensusStatus.UNSPECIFIED);
    });
  });

  describe("getTransactionStatus", () => {
    it("should return transaction status", async () => {
      const ctx = createMockContext();
      const mockStatus = create(TransactionStatusSchema, {
        signature: { value: generateTestSignature() },
        consensusStatus: ConsensusStatus.FINALIZED,
      });
      vi.spyOn(ctx.query, "getTransactionStatus").mockResolvedValue(mockStatus);
      
      const signature = generateTestSignature();
      const result = await getTransactionStatus(ctx, signature);
      
      expect(result).toBe(mockStatus);
      expect(ctx.query.getTransactionStatus).toHaveBeenCalledTimes(1);
    });
  });

  describe("buildTransaction", () => {
    it("should build transaction with minimal options", async () => {
      const ctx = createMockContext();
      const mockAccount = createMockAccount({
        meta: { nonce: 5n },
      });
      const mockHeight = createMockHeightResponse({ finalized: 1000n });
      
      vi.spyOn(ctx.query, "getAccount").mockResolvedValue(mockAccount);
      vi.spyOn(ctx.query, "getHeight").mockResolvedValue(mockHeight);
      
      const publicKey = generateTestPubkey(0x01);
      const transaction = await buildTransaction(ctx, {
        feePayer: { publicKey },
        program: generateTestPubkey(0x02),
      });
      
      expect(transaction).toBeInstanceOf(Transaction);
      expect(transaction.feePayer).toEqual(publicKey);
      expect(transaction.nonce).toBe(5n);
      expect(transaction.startSlot).toBe(1000n);
    });

    it("should use provided nonce instead of fetching", async () => {
      const ctx = createMockContext();
      const mockHeight = createMockHeightResponse({ finalized: 1000n });
      vi.spyOn(ctx.query, "getHeight").mockResolvedValue(mockHeight);
      
      const publicKey = generateTestPubkey(0x01);
      const transaction = await buildTransaction(ctx, {
        feePayer: { publicKey },
        program: generateTestPubkey(0x02),
        header: {
          nonce: 10n,
        },
      });
      
      expect(transaction.nonce).toBe(10n);
      expect(ctx.query.getAccount).not.toHaveBeenCalled();
    });

    it("should use provided startSlot instead of fetching", async () => {
      const ctx = createMockContext();
      const mockAccount = createMockAccount({
        meta: { nonce: 5n },
      });
      vi.spyOn(ctx.query, "getAccount").mockResolvedValue(mockAccount);
      
      const publicKey = generateTestPubkey(0x01);
      const transaction = await buildTransaction(ctx, {
        feePayer: { publicKey },
        program: generateTestPubkey(0x02),
        header: {
          startSlot: 2000n,
        },
      });
      
      expect(transaction.startSlot).toBe(2000n);
      expect(ctx.query.getHeight).not.toHaveBeenCalled();
    });

    it("should use default header values when not provided", async () => {
      const ctx = createMockContext();
      const mockAccount = createMockAccount({
        meta: { nonce: 5n },
      });
      const mockHeight = createMockHeightResponse({ finalized: 1000n });
      
      vi.spyOn(ctx.query, "getAccount").mockResolvedValue(mockAccount);
      vi.spyOn(ctx.query, "getHeight").mockResolvedValue(mockHeight);
      
      const publicKey = generateTestPubkey(0x01);
      const transaction = await buildTransaction(ctx, {
        feePayer: { publicKey },
        program: generateTestPubkey(0x02),
      });
      
      expect(transaction.fee).toBe(1n); // DEFAULT_FEE
      expect(transaction.expiryAfter).toBe(100); // DEFAULT_EXPIRY_AFTER
      expect(transaction.requestedComputeUnits).toBe(300_000_000); // DEFAULT_COMPUTE_UNITS
      expect(transaction.requestedStateUnits).toBe(10_000); // DEFAULT_STATE_UNITS
      expect(transaction.requestedMemoryUnits).toBe(10_000); // DEFAULT_MEMORY_UNITS
    });

    it("should accept program as string", async () => {
      const ctx = createMockContext();
      const mockAccount = createMockAccount({
        meta: { nonce: 5n },
      });
      const mockHeight = createMockHeightResponse({ finalized: 1000n });
      
      vi.spyOn(ctx.query, "getAccount").mockResolvedValue(mockAccount);
      vi.spyOn(ctx.query, "getHeight").mockResolvedValue(mockHeight);
      
      const publicKey = generateTestPubkey(0x01);
      const programAddress = generateTestAddress(0x02);
      const transaction = await buildTransaction(ctx, {
        feePayer: { publicKey },
        program: programAddress,
      });
      
      expect(transaction.program.length).toBe(32);
    });

    it("should throw error when account nonce is unavailable", async () => {
      const ctx = createMockContext();
      const mockHeight = createMockHeightResponse({ finalized: 1000n });
      
      // Mock account with meta that has undefined nonce
      // Since nonce is required in protobuf, we need to manually create an object
      // that simulates the case where meta.nonce is undefined
      const mockAccount = {
        address: { value: generateTestPubkey(0x01) },
        meta: {
          version: 1,
          flags: {},
          dataSize: 0,
          seq: 0n,
          owner: { value: generateTestPubkey(0x02) },
          balance: 0n,
          // nonce is explicitly undefined
          nonce: undefined,
        },
      };
      
      vi.spyOn(ctx.query, "getAccount").mockResolvedValue(mockAccount as any);
      vi.spyOn(ctx.query, "getHeight").mockResolvedValue(mockHeight);
      
      const publicKey = generateTestPubkey(0x01);
      
      await expect(
        buildTransaction(ctx, {
          feePayer: { publicKey },
          program: generateTestPubkey(0x02),
        })
      ).rejects.toThrow("Fee payer account nonce is unavailable");
    });

    it("should accept instruction data as Uint8Array", async () => {
      const ctx = createMockContext();
      const mockAccount = createMockAccount({
        meta: { nonce: 5n },
      });
      const mockHeight = createMockHeightResponse({ finalized: 1000n });
      
      vi.spyOn(ctx.query, "getAccount").mockResolvedValue(mockAccount);
      vi.spyOn(ctx.query, "getHeight").mockResolvedValue(mockHeight);
      
      const instructionData = new Uint8Array([0x01, 0x02, 0x03]);
      const transaction = await buildTransaction(ctx, {
        feePayer: { publicKey: generateTestPubkey(0x01) },
        program: generateTestPubkey(0x02),
        instructionData,
      });
      
      expect(transaction.instructionData).toEqual(instructionData);
    });

    it("should accept instruction data as function", async () => {
      const ctx = createMockContext();
      const mockAccount = createMockAccount({
        meta: { nonce: 5n },
      });
      const mockHeight = createMockHeightResponse({ finalized: 1000n });
      
      vi.spyOn(ctx.query, "getAccount").mockResolvedValue(mockAccount);
      vi.spyOn(ctx.query, "getHeight").mockResolvedValue(mockHeight);
      
      const instructionDataFn = async (context: any) => {
        // Function that uses context to generate instruction data
        return new Uint8Array([context.accounts.length]);
      };
      
      const transaction = await buildTransaction(ctx, {
        feePayer: { publicKey: generateTestPubkey(0x01) },
        program: generateTestPubkey(0x02),
        instructionData: instructionDataFn,
      });
      
      expect(transaction.instructionData).toBeDefined();
    });

    it("should build transaction with instructionData function using context builder", async () => {
      const ctx = createMockContext();
      const mockAccount = createMockAccount({
        meta: { nonce: 5n },
      });
      const mockHeight = createMockHeightResponse({ finalized: 1000n });
      
      vi.spyOn(ctx.query, "getAccount").mockResolvedValue(mockAccount);
      vi.spyOn(ctx.query, "getHeight").mockResolvedValue(mockHeight);
      
      const feePayer = generateTestPubkey(0x01);
      const program = generateTestPubkey(0x02);
      const readWriteAccount1 = generateTestPubkey(0x03);
      const readWriteAccount2 = generateTestPubkey(0x04);
      const readOnlyAccount = generateTestPubkey(0x05);
      
      // Instruction data function that uses the context to:
      // 1. Access the accounts array
      // 2. Use getAccountIndex to find account positions
      // 3. Build instruction data with account indices
      const instructionDataFn = async (context: InstructionContext) => {
        // Verify context has all accounts in correct order
        expect(context.accounts.length).toBe(5); // feePayer, program, 2 readWrite, 1 readOnly
        expect(context.accounts[0]).toEqual(feePayer);
        expect(context.accounts[1]).toEqual(program);
        expect(context.accounts[2]).toEqual(readWriteAccount1);
        expect(context.accounts[3]).toEqual(readWriteAccount2);
        expect(context.accounts[4]).toEqual(readOnlyAccount);
        
        // Use getAccountIndex to find account positions
        const feePayerIndex = context.getAccountIndex(feePayer);
        const programIndex = context.getAccountIndex(program);
        const readWrite1Index = context.getAccountIndex(readWriteAccount1);
        const readOnlyIndex = context.getAccountIndex(readOnlyAccount);
        
        // Verify indices are correct
        expect(feePayerIndex).toBe(0);
        expect(programIndex).toBe(1);
        expect(readWrite1Index).toBe(2);
        expect(readOnlyIndex).toBe(4);
        
        // Build instruction data using account indices (common pattern)
        // Example: [instructionDiscriminator, accountIndex1, accountIndex2, ...]
        const instructionData = new Uint8Array([
          0x42, // instruction discriminator
          feePayerIndex,
          programIndex,
          readWrite1Index,
          readOnlyIndex,
        ]);
        
        return instructionData;
      };
      
      const transaction = await buildTransaction(ctx, {
        feePayer: { publicKey: feePayer },
        program,
        accounts: {
          readWrite: [readWriteAccount1, readWriteAccount2],
          readOnly: [readOnlyAccount],
        },
        instructionData: instructionDataFn,
      });
      
      expect(transaction.instructionData).toBeDefined();
      expect(transaction.instructionData!.length).toBe(5);
      expect(transaction.instructionData![0]).toBe(0x42); // discriminator
      expect(transaction.instructionData![1]).toBe(0); // feePayer index
      expect(transaction.instructionData![2]).toBe(1); // program index
      expect(transaction.instructionData![3]).toBe(2); // readWrite1 index
      expect(transaction.instructionData![4]).toBe(4); // readOnly index
      
      // Verify accounts are in the transaction
      expect(transaction.readWriteAccounts).toHaveLength(2);
      expect(transaction.readOnlyAccounts).toHaveLength(1);
    });

    it("should throw error in instructionData function when account not found via getAccountIndex", async () => {
      const ctx = createMockContext();
      const mockAccount = createMockAccount({
        meta: { nonce: 5n },
      });
      const mockHeight = createMockHeightResponse({ finalized: 1000n });
      
      vi.spyOn(ctx.query, "getAccount").mockResolvedValue(mockAccount);
      vi.spyOn(ctx.query, "getHeight").mockResolvedValue(mockHeight);
      
      const feePayer = generateTestPubkey(0x01);
      const program = generateTestPubkey(0x02);
      const unknownAccount = generateTestPubkey(0x99); // Not in transaction accounts
      
      const instructionDataFn = async (context: {
        accounts: Uint8Array[];
        getAccountIndex: (pubkey: Uint8Array) => number;
      }) => {
        // Try to get index of an account not in the transaction
        expect(() => context.getAccountIndex(unknownAccount)).toThrow(
          "Account not found in transaction accounts"
        );
        return new Uint8Array([0x01]);
      };
      
      const transaction = await buildTransaction(ctx, {
        feePayer: { publicKey: feePayer },
        program,
        instructionData: instructionDataFn,
      });
      
      expect(transaction.instructionData).toBeDefined();
    });
  });

  describe("buildAndSignTransaction", () => {
    it("should build and sign transaction", async () => {
      const ctx = createMockContext();
      const mockAccount = createMockAccount({
        meta: { nonce: 5n },
      });
      const mockHeight = createMockHeightResponse({ finalized: 1000n });
      
      vi.spyOn(ctx.query, "getAccount").mockResolvedValue(mockAccount);
      vi.spyOn(ctx.query, "getHeight").mockResolvedValue(mockHeight);
      
      const publicKey = generateTestPubkey(0x01);
      const privateKey = new Uint8Array(32);
      privateKey.fill(0x42);
      
      const result = await buildAndSignTransaction(ctx, {
        feePayer: {
          publicKey,
          privateKey,
        },
        program: generateTestPubkey(0x02),
      });
      
      expect(result.transaction).toBeInstanceOf(Transaction);
      expect(result.signature.length).toBe(64);
      expect(result.rawTransaction.length).toBeGreaterThan(0);
    });

    it("should throw error when private key is missing", async () => {
      const ctx = createMockContext();
      const mockAccount = createMockAccount({
        meta: { nonce: 5n },
      });
      const mockHeight = createMockHeightResponse({ finalized: 1000n });
      
      vi.spyOn(ctx.query, "getAccount").mockResolvedValue(mockAccount);
      vi.spyOn(ctx.query, "getHeight").mockResolvedValue(mockHeight);
      
      const publicKey = generateTestPubkey(0x01);
      
      await expect(
        buildAndSignTransaction(ctx, {
          feePayer: {
            publicKey,
            // No privateKey
          },
          program: generateTestPubkey(0x02),
        } as any)
      ).rejects.toThrow("Fee payer private key is required to sign the transaction");
    });
  });

  describe("sendTransaction", () => {
    it("should send transaction object", async () => {
      const ctx = createMockContext();
      const mockSignature = generateTestSignature();
      const mockResponse = {
        signature: { value: mockSignature },
      };
      vi.spyOn(ctx.command, "sendTransaction").mockResolvedValue(mockResponse as any);
      
      const transaction = new Transaction({
        feePayer: generateTestPubkey(0x01),
        program: generateTestPubkey(0x02),
        header: {
          fee: 1n,
          nonce: 2n,
          startSlot: 3n,
        },
      });
      
      const result = await sendTransaction(ctx, transaction);
      
      expect(typeof result).toBe("string");
      expect(result.startsWith("ts")).toBe(true);
      expect(ctx.command.sendTransaction).toHaveBeenCalledTimes(1);
    });

    it("should send raw transaction bytes", async () => {
      const ctx = createMockContext();
      const mockSignature = generateTestSignature();
      const mockResponse = {
        signature: { value: mockSignature },
      };
      vi.spyOn(ctx.command, "sendTransaction").mockResolvedValue(mockResponse as any);
      
      const rawTransaction = new Uint8Array([1, 2, 3, 4]);
      const result = await sendTransaction(ctx, rawTransaction);
      
      expect(typeof result).toBe("string");
      expect(ctx.command.sendTransaction).toHaveBeenCalledTimes(1);
      const callArgs = (ctx.command.sendTransaction as any).mock.calls[0][0];
      expect(callArgs.rawTransaction).toEqual(rawTransaction);
    });

    it("should throw error when signature is missing from response", async () => {
      const ctx = createMockContext();
      const mockResponse = {
        // No signature
      };
      vi.spyOn(ctx.command, "sendTransaction").mockResolvedValue(mockResponse as any);
      
      const transaction = new Transaction({
        feePayer: generateTestPubkey(0x01),
        program: generateTestPubkey(0x02),
        header: {
          fee: 1n,
          nonce: 2n,
          startSlot: 3n,
        },
      });
      
      await expect(sendTransaction(ctx, transaction)).rejects.toThrow(
        "No signature returned from sendTransaction"
      );
    });
  });

  describe("listTransactionsForAccount", () => {
    it("should list transactions for account", async () => {
      const ctx = createMockContext();
      const mockResponse = {
        signatures: [
          { value: generateTestSignature(0x01) },
          { value: generateTestSignature(0x02) },
        ],
      };
      vi.spyOn(ctx.query, "listTransactionsForAccount").mockResolvedValue(mockResponse as any);
      
      const account = generateTestPubkey();
      const result = await listTransactionsForAccount(ctx, account);
      
      expect(result).toBe(mockResponse);
      expect(ctx.query.listTransactionsForAccount).toHaveBeenCalledTimes(1);
      const callArgs = (ctx.query.listTransactionsForAccount as any).mock.calls[0][0];
      expect(callArgs.account?.value).toEqual(account);
    });

    it("should accept account as Uint8Array", async () => {
      const ctx = createMockContext();
      const mockResponse = { signatures: [] };
      vi.spyOn(ctx.query, "listTransactionsForAccount").mockResolvedValue(mockResponse as any);
      
      const account = generateTestPubkey();
      await listTransactionsForAccount(ctx, account);
      
      const callArgs = (ctx.query.listTransactionsForAccount as any).mock.calls[0][0];
      expect(callArgs.account?.value).toEqual(account);
    });

    it("should accept account as string", async () => {
      const ctx = createMockContext();
      const mockResponse = { signatures: [] };
      vi.spyOn(ctx.query, "listTransactionsForAccount").mockResolvedValue(mockResponse as any);
      
      const accountString = generateTestAddress();
      await listTransactionsForAccount(ctx, accountString);
      
      const callArgs = (ctx.query.listTransactionsForAccount as any).mock.calls[0][0];
      expect(callArgs.account?.value.length).toBe(32);
    });

    it("should pass page options", async () => {
      const ctx = createMockContext();
      const mockResponse = { signatures: [] };
      vi.spyOn(ctx.query, "listTransactionsForAccount").mockResolvedValue(mockResponse as any);
      
      const account = generateTestPubkey();
      const page = create(PageRequestSchema, { pageSize: 20, pageToken: "token123" });
      await listTransactionsForAccount(ctx, account, { page });
      
      const callArgs = (ctx.query.listTransactionsForAccount as any).mock.calls[0][0];
      expect(callArgs.page?.pageSize).toBe(20);
      expect(callArgs.page?.pageToken).toBe("token123");
    });

    it("should pass filter options", async () => {
      const ctx = createMockContext();
      const mockResponse = { signatures: [] };
      vi.spyOn(ctx.query, "listTransactionsForAccount").mockResolvedValue(mockResponse as any);
      
      const account = generateTestPubkey();
      const filter = create(FilterSchema, { expression: "meta.value > 0" });
      await listTransactionsForAccount(ctx, account, { filter });
      
      const callArgs = (ctx.query.listTransactionsForAccount as any).mock.calls[0][0];
      expect(callArgs.filter?.expression).toBe("meta.value > 0");
    });
  });

  describe("batchSendTransactions", () => {
    it("should send batch of transactions", async () => {
      const ctx = createMockContext();
      const mockResponse = {
        signatures: [
          { value: generateTestSignature(0x01) },
          { value: generateTestSignature(0x02) },
        ],
      };
      vi.spyOn(ctx.command, "batchSendTransactions").mockResolvedValue(mockResponse as any);
      
      const transactions = [
        new Uint8Array([1, 2, 3]),
        new Uint8Array([4, 5, 6]),
      ];
      const result = await batchSendTransactions(ctx, transactions);
      
      expect(result).toBe(mockResponse);
      expect(ctx.command.batchSendTransactions).toHaveBeenCalledTimes(1);
      const callArgs = (ctx.command.batchSendTransactions as any).mock.calls[0][0];
      expect(callArgs.rawTransactions).toHaveLength(2);
      expect(callArgs.rawTransactions[0]).toEqual(transactions[0]);
      expect(callArgs.rawTransactions[1]).toEqual(transactions[1]);
    });

    it("should convert Transaction objects to raw bytes", async () => {
      const ctx = createMockContext();
      const mockResponse = { signatures: [{ value: generateTestSignature() }] };
      vi.spyOn(ctx.command, "batchSendTransactions").mockResolvedValue(mockResponse as any);
      
      const transaction = new Transaction({
        feePayer: generateTestPubkey(0x01),
        program: generateTestPubkey(0x02),
        header: {
          fee: 1n,
          nonce: 2n,
          startSlot: 3n,
        },
      });
      
      await batchSendTransactions(ctx, [transaction]);
      
      const callArgs = (ctx.command.batchSendTransactions as any).mock.calls[0][0];
      expect(callArgs.rawTransactions).toHaveLength(1);
      expect(callArgs.rawTransactions[0]).toBeInstanceOf(Uint8Array);
    });

    it("should handle mixed Transaction objects and raw bytes", async () => {
      const ctx = createMockContext();
      const mockResponse = { signatures: [] };
      vi.spyOn(ctx.command, "batchSendTransactions").mockResolvedValue(mockResponse as any);
      
      const transaction = new Transaction({
        feePayer: generateTestPubkey(0x01),
        program: generateTestPubkey(0x02),
        header: {
          fee: 1n,
          nonce: 2n,
          startSlot: 3n,
        },
      });
      const rawBytes = new Uint8Array([1, 2, 3]);
      
      await batchSendTransactions(ctx, [transaction, rawBytes]);
      
      const callArgs = (ctx.command.batchSendTransactions as any).mock.calls[0][0];
      expect(callArgs.rawTransactions).toHaveLength(2);
      expect(callArgs.rawTransactions[0]).toBeInstanceOf(Uint8Array);
      expect(callArgs.rawTransactions[1]).toBe(rawBytes);
    });

    it("should pass numRetries option", async () => {
      const ctx = createMockContext();
      const mockResponse = { signatures: [] };
      vi.spyOn(ctx.command, "batchSendTransactions").mockResolvedValue(mockResponse as any);
      
      await batchSendTransactions(ctx, [new Uint8Array([1])], { numRetries: 5 });
      
      const callArgs = (ctx.command.batchSendTransactions as any).mock.calls[0][0];
      expect(callArgs.numRetries).toBe(5);
    });

    it("should default numRetries to 0 when not provided", async () => {
      const ctx = createMockContext();
      const mockResponse = { signatures: [] };
      vi.spyOn(ctx.command, "batchSendTransactions").mockResolvedValue(mockResponse as any);
      
      await batchSendTransactions(ctx, [new Uint8Array([1])]);
      
      const callArgs = (ctx.command.batchSendTransactions as any).mock.calls[0][0];
      expect(callArgs.numRetries).toBe(0);
    });
  });
});

