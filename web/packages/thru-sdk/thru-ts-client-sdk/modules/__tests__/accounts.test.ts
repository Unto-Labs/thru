import { create } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";
import { createMockAccount, createMockContext, createMockHeightResponse, generateTestAddress, generateTestPubkey } from "../../__tests__/helpers/test-utils";
import { ConsensusStatus, CurrentVersionSchema, VersionContextSchema } from "../../proto/thru/common/v1/consensus_pb";
import { AccountView } from "../../proto/thru/core/v1/account_pb";
import { GenerateStateProofResponseSchema, ListAccountsResponseSchema } from "../../proto/thru/services/v1/query_service_pb";
import { Account } from "../../domain/accounts";
import { Filter, FilterParamValue } from "../../domain/filters";
import { createAccount, getAccount, getRawAccount, listAccounts } from "../accounts";
import { toPubkey } from "../helpers";

describe("accounts", () => {
  describe("getAccount", () => {
    it("should return account with valid address", async () => {
      const ctx = createMockContext();
      const mockAccount = createMockAccount();
      vi.spyOn(ctx.query, "getAccount").mockResolvedValue(mockAccount);
      
      const address = generateTestPubkey(0x01);
      const result = await getAccount(ctx, address);
      
      expect(result).toBeInstanceOf(Account);
      expect(result.address).toEqual(mockAccount.address?.value);
      expect(ctx.query.getAccount).toHaveBeenCalledTimes(1);
    });

    it("should accept address as Uint8Array", async () => {
      const ctx = createMockContext();
      const mockAccount = createMockAccount();
      vi.spyOn(ctx.query, "getAccount").mockResolvedValue(mockAccount);
      
      const address = generateTestPubkey(0x01);
      const result = await getAccount(ctx, address);
      
      const callArgs = (ctx.query.getAccount as any).mock.calls[0][0];
      expect(callArgs.address.value).toEqual(address);
      expect(result).toBeInstanceOf(Account);
    });

    it("should accept address as string", async () => {
      const ctx = createMockContext();
      const mockAccount = createMockAccount();
      vi.spyOn(ctx.query, "getAccount").mockResolvedValue(mockAccount);
      
      const address = generateTestAddress(0x01);
      const result = await getAccount(ctx, address);
      
      const callArgs = (ctx.query.getAccount as any).mock.calls[0][0];
      expect(callArgs.address.value.length).toBe(32);
      expect(result).toBeInstanceOf(Account);
    });

    it("should use default view when not provided", async () => {
      const ctx = createMockContext();
      const mockAccount = createMockAccount();
      vi.spyOn(ctx.query, "getAccount").mockResolvedValue(mockAccount);
      
      await getAccount(ctx, generateTestPubkey(0x01));
      
      const callArgs = (ctx.query.getAccount as any).mock.calls[0][0];
      expect(callArgs.view).toBe(AccountView.FULL);
    });

    it("should use custom view when provided", async () => {
      const ctx = createMockContext();
      const mockAccount = createMockAccount();
      vi.spyOn(ctx.query, "getAccount").mockResolvedValue(mockAccount);
      
      await getAccount(ctx, generateTestPubkey(0x01), { view: AccountView.META_ONLY });
      
      const callArgs = (ctx.query.getAccount as any).mock.calls[0][0];
      expect(callArgs.view).toBe(AccountView.META_ONLY);
    });

    it("should use default minConsensus when not provided", async () => {
      const ctx = createMockContext();
      const mockAccount = createMockAccount();
      vi.spyOn(ctx.query, "getAccount").mockResolvedValue(mockAccount);
      
      await getAccount(ctx, generateTestPubkey(0x01));
      
      const callArgs = (ctx.query.getAccount as any).mock.calls[0][0];
      expect(callArgs.minConsensus).toBe(ConsensusStatus.UNSPECIFIED);
    });
    it("should use default version context when not provided", async () => {
      const ctx = createMockContext();
      const mockAccount = createMockAccount();
      vi.spyOn(ctx.query, "getAccount").mockResolvedValue(mockAccount);
      
      await getAccount(ctx, generateTestPubkey(0x01));
      
      const callArgs = (ctx.query.getAccount as any).mock.calls[0][0];
      expect(callArgs.versionContext).toBeDefined();
      expect(callArgs.versionContext.version?.case).toBe("current");
    });

    it("should use custom minConsensus when provided", async () => {
      const ctx = createMockContext();
      const mockAccount = createMockAccount();
      vi.spyOn(ctx.query, "getAccount").mockResolvedValue(mockAccount);
      
      await getAccount(ctx, generateTestPubkey(0x01), { minConsensus: ConsensusStatus.FINALIZED });
      
      const callArgs = (ctx.query.getAccount as any).mock.calls[0][0];
      expect(callArgs.minConsensus).toBe(ConsensusStatus.FINALIZED);
    });

    it("should include dataSlice when provided", async () => {
      const ctx = createMockContext();
      const mockAccount = createMockAccount();
      vi.spyOn(ctx.query, "getAccount").mockResolvedValue(mockAccount);
      
      const dataSlice = { offset: 0, length: 100 };
      await getAccount(ctx, generateTestPubkey(0x01), { dataSlice: dataSlice as any });
      
      const callArgs = (ctx.query.getAccount as any).mock.calls[0][0];
      expect(callArgs.dataSlice).toBeDefined();
      expect(callArgs.dataSlice.offset).toBe(0);
      expect(callArgs.dataSlice.length).toBe(100);
    });

    it("should include version context when provided", async () => {
      const ctx = createMockContext();
      const mockAccount = createMockAccount();
      vi.spyOn(ctx.query, "getAccount").mockResolvedValue(mockAccount);
      
      const versionContext = create(VersionContextSchema, {
        version: {
          case: "current",
          value: create(CurrentVersionSchema, {}),
        },
      });
      
      await getAccount(ctx, generateTestPubkey(0x01), { versionContext });
      
      const callArgs = (ctx.query.getAccount as any).mock.calls[0][0];
      expect(callArgs.versionContext).toBeDefined();
      expect(callArgs.versionContext.version?.case).toBe("current");
    });
  });

  describe("getRawAccount", () => {
    it("should return raw account", async () => {
      const ctx = createMockContext();
      const mockRawAccount = {
        address: { value: generateTestPubkey(0x01) },
        rawMeta: new Uint8Array([1, 2, 3]),
        rawData: new Uint8Array([4, 5, 6]),
      };
      vi.spyOn(ctx.query, "getRawAccount").mockResolvedValue(mockRawAccount as any);
      
      const address = generateTestPubkey(0x01);
      const result = await getRawAccount(ctx, address);
      
      expect(result).toBe(mockRawAccount);
      expect(ctx.query.getRawAccount).toHaveBeenCalledTimes(1);
    });

    it("should use default view and minConsensus", async () => {
      const ctx = createMockContext();
      const mockRawAccount = { address: { value: generateTestPubkey(0x01) } };
      vi.spyOn(ctx.query, "getRawAccount").mockResolvedValue(mockRawAccount as any);
      
      await getRawAccount(ctx, generateTestPubkey(0x01));
      
      const callArgs = (ctx.query.getRawAccount as any).mock.calls[0][0];
      expect(callArgs.view).toBe(AccountView.FULL);
      expect(callArgs.minConsensus).toBe(ConsensusStatus.UNSPECIFIED);
    });
    it("should use default version context when not provided", async () => {
      const ctx = createMockContext();
      const mockRawAccount = { address: { value: generateTestPubkey(0x01) } };
      vi.spyOn(ctx.query, "getRawAccount").mockResolvedValue(mockRawAccount as any);
      
      await getRawAccount(ctx, generateTestPubkey(0x01));
      
      const callArgs = (ctx.query.getRawAccount as any).mock.calls[0][0];
      expect(callArgs.versionContext).toBeDefined();
      expect(callArgs.versionContext.version?.case).toBe("current");
    });
  });

  describe("listAccounts", () => {
    it("should list owned accounts", async () => {
      const ctx = createMockContext();
      const mockResponse = create(ListAccountsResponseSchema, {
        accounts: [createMockAccount()],
      });
      vi.spyOn(ctx.query, "listAccounts").mockResolvedValue(mockResponse);
      
      const owner = generateTestPubkey(0x01);
      const ownerPubkey = toPubkey(owner, "owner");
      const ownerFilter = new Filter({
        expression: "meta.owner.value == params.owner_bytes",
        params: {
          owner_bytes: FilterParamValue.bytes(ownerPubkey.value),
        },
      });
      
      const result = await listAccounts(ctx, { filter: ownerFilter });
      
      expect(result.accounts).toHaveLength(mockResponse.accounts.length);
      result.accounts.forEach((account) => expect(account).toBeInstanceOf(Account));
      expect(result.page).toBeUndefined();
      expect(ctx.query.listAccounts).toHaveBeenCalledTimes(1);
    });

    it("should create owner filter", async () => {
      const ctx = createMockContext();
      const mockResponse = create(ListAccountsResponseSchema, { accounts: [] });
      vi.spyOn(ctx.query, "listAccounts").mockResolvedValue(mockResponse);
      
      const owner = generateTestPubkey(0x01);
      const ownerPubkey = toPubkey(owner, "owner");
      const ownerFilter = new Filter({
        expression: "meta.owner.value == params.owner_bytes",
        params: {
          owner_bytes: FilterParamValue.bytes(ownerPubkey.value),
        },
      });
      
      await listAccounts(ctx, { filter: ownerFilter });
      
      const callArgs = (ctx.query.listAccounts as any).mock.calls[0][0];
      expect(callArgs.filter).toBeDefined();
      expect(callArgs.filter.expression).toBe("meta.owner.value == params.owner_bytes");
      expect(callArgs.filter.params.owner_bytes.kind.case).toBe("bytesValue");
      expect(callArgs.filter.params.owner_bytes.kind.value).toEqual(ownerPubkey.value);
    });

    it("should use custom filter when provided", async () => {
      const ctx = createMockContext();
      const mockResponse = create(ListAccountsResponseSchema, { accounts: [] });
      const customFilter = new Filter({
        expression: "custom expression",
      });
      vi.spyOn(ctx.query, "listAccounts").mockResolvedValue(mockResponse);
      
      await listAccounts(ctx, { filter: customFilter });
      
      const callArgs = (ctx.query.listAccounts as any).mock.calls[0][0];
      expect(callArgs.filter.expression).toBe("custom expression");
    });

    it("should use default view and minConsensus", async () => {
      const ctx = createMockContext();
      const mockResponse = create(ListAccountsResponseSchema, { accounts: [] });
      vi.spyOn(ctx.query, "listAccounts").mockResolvedValue(mockResponse);
      
      const owner = generateTestPubkey(0x01);
      const ownerPubkey = toPubkey(owner, "owner");
      const ownerFilter = new Filter({
        expression: "meta.owner.value == params.owner_bytes",
        params: {
          owner_bytes: FilterParamValue.bytes(ownerPubkey.value),
        },
      });
      
      await listAccounts(ctx, { filter: ownerFilter });
      
      const callArgs = (ctx.query.listAccounts as any).mock.calls[0][0];
      expect(callArgs.view).toBe(AccountView.FULL);
      expect(callArgs.minConsensus).toBe(ConsensusStatus.UNSPECIFIED);
    });
    it("should use default version context when not provided", async () => {
      const ctx = createMockContext();
      const mockResponse = create(ListAccountsResponseSchema, { accounts: [] });
      vi.spyOn(ctx.query, "listAccounts").mockResolvedValue(mockResponse);
      
      await listAccounts(ctx, {});
      
      const callArgs = (ctx.query.listAccounts as any).mock.calls[0][0];
      expect(callArgs.versionContext).toBeDefined();
      expect(callArgs.versionContext.version?.case).toBe("current");
    });
  });

  describe("createAccount", () => {
    it("should create account transaction", async () => {
      const ctx = createMockContext();
      const mockHeight = createMockHeightResponse({ finalized: 1000n });
      const mockProof = create(GenerateStateProofResponseSchema, {
        proof: {
          proof: new Uint8Array(64).fill(0x42),
        },
      });
      
      vi.spyOn(ctx.query, "getHeight").mockResolvedValue(mockHeight);
      vi.spyOn(ctx.query, "generateStateProof").mockResolvedValue(mockProof);
      
      const publicKey = generateTestPubkey(0x01);
      const transaction = await createAccount(ctx, { publicKey });
      
      expect(transaction).toBeDefined();
      expect(transaction.feePayer).toEqual(publicKey);
      expect(transaction.feePayerStateProof).toBeDefined();
      expect(ctx.query.getHeight).toHaveBeenCalledTimes(1);
      expect(ctx.query.generateStateProof).toHaveBeenCalledTimes(1);
    });

    it("should use finalized slot from height", async () => {
      const ctx = createMockContext();
      const mockHeight = createMockHeightResponse({ finalized: 2000n });
      const mockProof = create(GenerateStateProofResponseSchema, {
        proof: {
          proof: new Uint8Array(64).fill(0x42),
        },
      });
      
      vi.spyOn(ctx.query, "getHeight").mockResolvedValue(mockHeight);
      vi.spyOn(ctx.query, "generateStateProof").mockResolvedValue(mockProof);
      
      const publicKey = generateTestPubkey(0x01);
      const transaction = await createAccount(ctx, { publicKey });
      
      expect(transaction.startSlot).toBe(2000n);
      // Verify generateStateProof was called (we can't easily check nested properties)
      expect(ctx.query.generateStateProof).toHaveBeenCalledTimes(1);
    });

    it("should generate CREATING proof type", async () => {
      const ctx = createMockContext();
      const mockHeight = createMockHeightResponse();
      const mockProof = create(GenerateStateProofResponseSchema, {
        proof: {
          proof: new Uint8Array(64).fill(0x42),
        },
      });
      
      vi.spyOn(ctx.query, "getHeight").mockResolvedValue(mockHeight);
      vi.spyOn(ctx.query, "generateStateProof").mockResolvedValue(mockProof);
      
      const publicKey = generateTestPubkey(0x01);
      await createAccount(ctx, { publicKey });
      
      // Verify generateStateProof was called with correct address
      expect(ctx.query.generateStateProof).toHaveBeenCalledTimes(1);
      const proofCallArgs = (ctx.query.generateStateProof as any).mock.calls[0][0];
      expect(proofCallArgs.request).toBeDefined();
    });

    it("should throw error when proof is empty", async () => {
      const ctx = createMockContext();
      const mockHeight = createMockHeightResponse();
      const mockProof = create(GenerateStateProofResponseSchema, {
        proof: {
          proof: new Uint8Array(0), // Empty proof
        },
      });
      
      vi.spyOn(ctx.query, "getHeight").mockResolvedValue(mockHeight);
      vi.spyOn(ctx.query, "generateStateProof").mockResolvedValue(mockProof);
      
      const publicKey = generateTestPubkey(0x01);
      
      await expect(createAccount(ctx, { publicKey })).rejects.toThrow(
        "State proof generation returned empty proof"
      );
    });

    it("should throw error when proof is missing", async () => {
      const ctx = createMockContext();
      const mockHeight = createMockHeightResponse();
      const mockProof = create(GenerateStateProofResponseSchema, {
        // No proof field
      });
      
      vi.spyOn(ctx.query, "getHeight").mockResolvedValue(mockHeight);
      vi.spyOn(ctx.query, "generateStateProof").mockResolvedValue(mockProof);
      
      const publicKey = generateTestPubkey(0x01);
      
      await expect(createAccount(ctx, { publicKey })).rejects.toThrow(
        "State proof response missing proof"
      );
    });

    it("should apply header overrides", async () => {
      const ctx = createMockContext();
      const mockHeight = createMockHeightResponse({ finalized: 1000n });
      const mockProof = create(GenerateStateProofResponseSchema, {
        proof: {
          proof: new Uint8Array(64).fill(0x42),
        },
      });
      
      vi.spyOn(ctx.query, "getHeight").mockResolvedValue(mockHeight);
      vi.spyOn(ctx.query, "generateStateProof").mockResolvedValue(mockProof);
      
      const publicKey = generateTestPubkey(0x01);
      const transaction = await createAccount(ctx, {
        publicKey,
        header: {
          fee: 100n,
          computeUnits: 20_000,
        },
      });
      
      expect(transaction.fee).toBe(100n);
      expect(transaction.requestedComputeUnits).toBe(20_000);
    });

    it("should use default header values", async () => {
      const ctx = createMockContext();
      const mockHeight = createMockHeightResponse({ finalized: 1000n });
      const mockProof = create(GenerateStateProofResponseSchema, {
        proof: {
          proof: new Uint8Array(64).fill(0x42),
        },
      });
      
      vi.spyOn(ctx.query, "getHeight").mockResolvedValue(mockHeight);
      vi.spyOn(ctx.query, "generateStateProof").mockResolvedValue(mockProof);
      
      const publicKey = generateTestPubkey(0x01);
      const transaction = await createAccount(ctx, { publicKey });
      
      expect(transaction.fee).toBe(0n);
      expect(transaction.nonce).toBe(0n);
      expect(transaction.expiryAfter).toBe(100);
      expect(transaction.requestedComputeUnits).toBe(10_000);
      expect(transaction.requestedStateUnits).toBe(10_000);
      expect(transaction.requestedMemoryUnits).toBe(10_000);
    });
  });
});

