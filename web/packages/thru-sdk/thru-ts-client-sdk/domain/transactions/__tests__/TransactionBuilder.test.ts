import { describe, expect, it } from "vitest";
import { generateTestAddress, generateTestPubkey } from "../../../__tests__/helpers/test-utils";
import { Transaction } from "../Transaction";
import { TransactionBuilder } from "../TransactionBuilder";
import { Signature } from "../../primitives";
import type { BuildTransactionParams } from "../types";

describe("TransactionBuilder", () => {
  const createBuilder = () => new TransactionBuilder();

  const createMinimalParams = (): BuildTransactionParams => {
    return {
      feePayer: {
        publicKey: generateTestPubkey(0x01),
      },
      program: generateTestPubkey(0x02),
      header: {
        fee: 1n,
        nonce: 2n,
        startSlot: 3n,
      },
    };
  };

  const createPrivateKey = (): Uint8Array => {
    // Ed25519 private key is 32 bytes (seed), but we need to generate a valid one
    // For testing, we'll use a 32-byte array
    const privateKey = new Uint8Array(32);
    privateKey.fill(0x42);
    return privateKey;
  };

  describe("build", () => {
    it("should build transaction with minimal params", () => {
      const builder = createBuilder();
      const params = createMinimalParams();
      
      const transaction = builder.build(params);
      
      expect(transaction).toBeInstanceOf(Transaction);
      expect(transaction.feePayer.toBytes()).toEqual(params.feePayer.publicKey as Uint8Array);
      expect(transaction.program.toBytes()).toEqual(params.program as Uint8Array);
      expect(transaction.fee).toBe(params.header.fee);
      expect(transaction.nonce).toBe(params.header.nonce);
      expect(transaction.startSlot).toBe(params.header.startSlot);
    });

    it("should build transaction with all header fields", () => {
      const builder = createBuilder();
      const params: BuildTransactionParams = {
        ...createMinimalParams(),
        header: {
          fee: 10n,
          nonce: 20n,
          startSlot: 30n,
          expiryAfter: 100,
          computeUnits: 300_000_000,
          stateUnits: 10_000,
          memoryUnits: 10_000,
          flags: 1,
        },
      };
      
      const transaction = builder.build(params);
      
      expect(transaction.fee).toBe(10n);
      expect(transaction.nonce).toBe(20n);
      expect(transaction.startSlot).toBe(30n);
      expect(transaction.expiryAfter).toBe(100);
      expect(transaction.requestedComputeUnits).toBe(300_000_000);
      expect(transaction.requestedStateUnits).toBe(10_000);
      expect(transaction.requestedMemoryUnits).toBe(10_000);
      expect(transaction.flags).toBe(1);
    });

    it("should accept program as Uint8Array", () => {
      const builder = createBuilder();
      const program = generateTestPubkey(0x02);
      const params: BuildTransactionParams = {
        ...createMinimalParams(),
        program,
      };
      
      const transaction = builder.build(params);
      
      expect(transaction.program.toBytes()).toEqual(program);
    });

    it("should accept program as ta- address string", () => {
      const builder = createBuilder();
      const programAddress = generateTestAddress(0x02);
      const params: BuildTransactionParams = {
        ...createMinimalParams(),
        program: programAddress,
      };
      
      const transaction = builder.build(params);
      
      expect(transaction.program.toBytes().length).toBe(32);
    });

    it("should accept program as hex string", () => {
      const builder = createBuilder();
      const programBytes = generateTestPubkey(0x02);
      const hexString = Array.from(programBytes)
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
      const params: BuildTransactionParams = {
        ...createMinimalParams(),
        program: hexString,
      };
      
      const transaction = builder.build(params);
      
      expect(transaction.program.toBytes()).toEqual(programBytes);
    });

    it("should normalize and sort accounts", () => {
      const builder = createBuilder();
      const account1 = generateTestPubkey(0x03);
      const account2 = generateTestPubkey(0x04);
      const account3 = generateTestPubkey(0x02);
      
      const params: BuildTransactionParams = {
        ...createMinimalParams(),
        accounts: {
          readWriteAccounts: [account1, account2, account3],
        },
      };
      
      const transaction = builder.build(params);
      
      expect(transaction.readWriteAccounts).toHaveLength(3);
      // Should be sorted
      expect(transaction.readWriteAccounts[0].toBytes()).toEqual(account3); // 0x02
      expect(transaction.readWriteAccounts[1].toBytes()).toEqual(account1); // 0x03
      expect(transaction.readWriteAccounts[2].toBytes()).toEqual(account2); // 0x04
    });

    it("should deduplicate accounts", () => {
      const builder = createBuilder();
      const account1 = generateTestPubkey(0x03);
      const account1Duplicate = new Uint8Array(account1);
      
      const params: BuildTransactionParams = {
        ...createMinimalParams(),
        accounts: {
          readWriteAccounts: [account1, account1Duplicate],
        },
      };
      
      const transaction = builder.build(params);
      
      expect(transaction.readWriteAccounts).toHaveLength(1);
      expect(transaction.readWriteAccounts[0].toBytes()).toEqual(account1);
    });

    it("should handle read-only accounts", () => {
      const builder = createBuilder();
      const readOnlyAccount = generateTestPubkey(0x05);
      
      const params: BuildTransactionParams = {
        ...createMinimalParams(),
        accounts: {
          readOnlyAccounts: [readOnlyAccount],
        },
      };
      
      const transaction = builder.build(params);
      
      expect(transaction.readOnlyAccounts).toHaveLength(1);
      expect(transaction.readOnlyAccounts[0].toBytes()).toEqual(readOnlyAccount);
    });

    it("should handle both read-write and read-only accounts", () => {
      const builder = createBuilder();
      const rwAccount = generateTestPubkey(0x03);
      const roAccount = generateTestPubkey(0x04);
      
      const params: BuildTransactionParams = {
        ...createMinimalParams(),
        accounts: {
          readWriteAccounts: [rwAccount],
          readOnlyAccounts: [roAccount],
        },
      };
      
      const transaction = builder.build(params);
      
      expect(transaction.readWriteAccounts).toHaveLength(1);
      expect(transaction.readOnlyAccounts).toHaveLength(1);
    });

    it("should handle instruction data as Uint8Array", () => {
      const builder = createBuilder();
      const instructionData = new Uint8Array([0x01, 0x02, 0x03]);
      
      const params: BuildTransactionParams = {
        ...createMinimalParams(),
        instructionData,
      };
      
      const transaction = builder.build(params);
      
      expect(transaction.instructionData).toEqual(instructionData);
    });

    it("should handle instruction data as hex string", () => {
      const builder = createBuilder();
      const instructionBytes = new Uint8Array([0x01, 0x02, 0x03]);
      const hexString = Array.from(instructionBytes)
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
      
      const params: BuildTransactionParams = {
        ...createMinimalParams(),
        instructionData: hexString,
      };
      
      const transaction = builder.build(params);
      
      expect(transaction.instructionData).toEqual(instructionBytes);
    });

    it("should set fee payer proof flag when proof is provided", () => {
      const builder = createBuilder();
      const proof = new Uint8Array(64);
      proof.fill(0x42);
      
      const params: BuildTransactionParams = {
        ...createMinimalParams(),
        header: {
          fee: 1n,
          nonce: 2n,
          startSlot: 3n,
          flags: 0,
        },
        proofs: {
          feePayerStateProof: proof,
        },
      };
      
      const transaction = builder.build(params);
      
      // Flag should be set (FLAG_HAS_FEE_PAYER_PROOF = 1 << 0 = 1)
      expect(transaction.flags & 1).toBe(1);
    });

    it("should not set fee payer proof flag when proof is not provided", () => {
      const builder = createBuilder();
      const params: BuildTransactionParams = {
        ...createMinimalParams(),
        header: {
          fee: 1n,
          nonce: 2n,
          startSlot: 3n,
          flags: 0,
        },
      };
      
      const transaction = builder.build(params);
      
      expect(transaction.flags & 1).toBe(0);
    });

    it("should preserve custom flags when proof is provided", () => {
      const builder = createBuilder();
      const proof = new Uint8Array(64);
      proof.fill(0x42);
      
      const params: BuildTransactionParams = {
        ...createMinimalParams(),
        header: {
          fee: 1n,
          nonce: 2n,
          startSlot: 3n,
          flags: 2, // Custom flag
        },
        proofs: {
          feePayerStateProof: proof,
        },
      };
      
      const transaction = builder.build(params);
      
      // Should have both custom flag (2) and proof flag (1) = 3
      expect(transaction.flags).toBe(3);
    });

    it("should store fee payer state proof", () => {
      const builder = createBuilder();
      const proof = new Uint8Array(64);
      proof.fill(0x42);
      
      const params: BuildTransactionParams = {
        ...createMinimalParams(),
        proofs: {
          feePayerStateProof: proof,
        },
      };
      
      const transaction = builder.build(params);
      
      expect(transaction.feePayerStateProof).toEqual(proof);
    });

    it("should store fee payer account meta raw", () => {
      const builder = createBuilder();
      const metaRaw = new Uint8Array(32);
      metaRaw.fill(0x43);
      
      const params: BuildTransactionParams = {
        ...createMinimalParams(),
        proofs: {
          feePayerAccountMetaRaw: metaRaw,
        },
      };
      
      const transaction = builder.build(params);
      
      expect(transaction.feePayerAccountMetaRaw).toEqual(metaRaw);
    });
  });

  describe("buildAndSign", () => {
    it("should build and sign transaction", async () => {
      const builder = createBuilder();
      const privateKey = createPrivateKey();
      const publicKey = generateTestPubkey(0x01);
      const params: BuildTransactionParams = {
        feePayer: {
          publicKey,
          privateKey,
        },
        program: generateTestPubkey(0x02),
        header: {
          fee: 1n,
          nonce: 2n,
          startSlot: 3n,
        },
      };
      
      const result = await builder.buildAndSign(params);
      
      expect(result.transaction).toBeInstanceOf(Transaction);
      expect(result.signature).toBeInstanceOf(Signature);
      expect(result.signature.toBytes().length).toBe(64);
      expect(result.rawTransaction).toBeInstanceOf(Uint8Array);
      expect(result.rawTransaction.length).toBeGreaterThan(0);
    });

    it("should throw error when private key is missing", async () => {
      const builder = createBuilder();
      const params: BuildTransactionParams = {
        ...createMinimalParams(),
        // No privateKey
      };
      
      await expect(builder.buildAndSign(params)).rejects.toThrow(
        "Fee payer private key is required to sign the transaction"
      );
    });

    it("should include signature in raw transaction", async () => {
      const builder = createBuilder();
      const privateKey = createPrivateKey();
      const publicKey = generateTestPubkey(0x01);
      const params: BuildTransactionParams = {
        feePayer: {
          publicKey,
          privateKey,
        },
        program: generateTestPubkey(0x02),
        header: {
          fee: 1n,
          nonce: 2n,
          startSlot: 3n,
        },
      };
      
      const result = await builder.buildAndSign(params);
      
      // Signature should be in first 64 bytes of raw transaction
      const signatureInRaw = result.rawTransaction.slice(0, 64);
      expect(signatureInRaw).toEqual(result.signature.toBytes());
    });

    it("should create valid wire format", async () => {
      const builder = createBuilder();
      const privateKey = createPrivateKey();
      const publicKey = generateTestPubkey(0x01);
      const params: BuildTransactionParams = {
        feePayer: {
          publicKey,
          privateKey,
        },
        program: generateTestPubkey(0x02),
        header: {
          fee: 1n,
          nonce: 2n,
          startSlot: 3n,
        },
      };
      
      const result = await builder.buildAndSign(params);
      
      // Should have at least header size (176 bytes)
      expect(result.rawTransaction.length).toBeGreaterThanOrEqual(176);
    });
  });
});

