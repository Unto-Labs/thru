import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DepositTarget,
  ThruNetwork,
  type DepositDestination,
} from "../protocol";
import {
  createPreparedDepositSnapshot,
  DepositTransactionError,
  createDepositConfig,
  type DepositRuntimeConfig,
  ensureDepositAccountForWallet,
  getReusablePreparedDepositDestination,
  getDepositAccountStateForWallet,
  signDepositTransactionWithActiveSession,
  waitForDepositBalanceForWallet,
} from "./index";

vi.mock("@thru/sdk/helpers", () => ({
  decodeAddress: vi.fn((address: string) => new Uint8Array([address.length])),
}));

describe("prepared deposit snapshots", () => {
  it("uses the canonical snapshot after validating a stateful caller object", () => {
    const actual = { ...DESTINATION };
    const snapshot = createPreparedDepositSnapshot(actual, "ta_wallet");
    let reads = 0;
    Object.defineProperty(actual, "tokenProgramAddress", {
      enumerable: true,
      get: () => {
        reads += 1;
        return reads === 1
          ? DESTINATION.tokenProgramAddress
          : "ta_attacker_program";
      },
    });

    const resolved = getReusablePreparedDepositDestination(
      actual,
      snapshot,
      "ta_wallet",
    );

    expect(resolved?.tokenProgramAddress).toBe(DESTINATION.tokenProgramAddress);
    expect(actual.tokenProgramAddress).toBe("ta_attacker_program");
    expect(resolved).not.toBe(actual);
  });
});

vi.mock("@thru/programs/passkey-manager", () => ({
  buildWalletAccountContext: vi.fn(() => ({
    readWriteAddresses: ["ta_token_account"],
    readOnlyAddresses: ["ta_token_program", "ta_mint"],
  })),
  bytesToBase64: vi.fn(() => "AQID"),
}));

vi.mock("@thru/programs/token", () => ({
  bytesToHex: vi.fn(() => "010203"),
  createInitializeAccountInstruction: vi.fn(
    () => async () => new Uint8Array([1, 2, 3]),
  ),
  deriveTokenAccountAddress: vi.fn(() => ({
    address: "ta_token_account",
    bytes: new Uint8Array([7]),
  })),
  formatRawAmount: vi.fn((amount: bigint) => amount.toString()),
  parseTokenAccountData: vi.fn(
    (account: { tokenInfo: unknown }) => account.tokenInfo,
  ),
}));

const DESTINATION: DepositDestination = {
  network: ThruNetwork.Alphanet,
  depositTarget: DepositTarget.Credits,
  tokenAccountAddress: "ta_token_account",
  mintAddress: "ta_mint",
  tokenProgramAddress: "ta_token_program",
  symbol: "CREDITS",
  decimals: 6,
};

const NOT_FOUND = { code: 5 };

const RUNTIME_CONFIG: DepositRuntimeConfig = {
  defaultNetwork: "devnet",
  networkConfigJson: JSON.stringify({
    devnet: {
      rpc_url: "https://rpc.devnet.example",
      default_deposit_target: "credits",
      providers: {
        unifold: {
          orders_enabled: true,
          public: {
            project_id: "project_devnet",
            publishable_key: "pk_devnet",
            stripe_link_enabled: "true",
          },
          settlement_network: "solana-mainnet",
          settlement_asset: "USDC",
          settlement_asset_address: "usdc_devnet",
          settlement_treasury: "treasury_devnet",
        },
        coinbase: {
          orders_enabled: true,
        },
      },
      targets: {
        credits: {
          mint_address: "ta_mint",
          token_program_address: "ta_token_program",
          symbol: "CREDITS",
          decimals: 6,
        },
      },
    },
  }),
};

function tokenAccount(amount: bigint) {
  return {
    tokenInfo: {
      mint: DESTINATION.mintAddress,
      owner: "ta_wallet",
      amount,
    },
  };
}

function createThru(
  options: {
    tokenExists?: boolean;
    balanceRaw?: bigint;
    failedSignature?: boolean;
  } = {},
) {
  let tokenExists = options.tokenExists ?? true;
  let balanceRaw = options.balanceRaw ?? 0n;
  const accounts = {
    get: vi.fn(async (address: string) => {
      if (address === DESTINATION.mintAddress) return {};
      if (address === DESTINATION.tokenAccountAddress && tokenExists) {
        return tokenAccount(balanceRaw);
      }
      throw NOT_FOUND;
    }),
  };
  const transactions = {
    send: vi.fn(async () => {
      tokenExists = true;
      balanceRaw = options.balanceRaw ?? 0n;
      return "ts_setup";
    }),
    getStatus: vi.fn(async () => ({
      executionResult: options.failedSignature
        ? {
            executionResult: 1n,
            userErrorCode: 14n,
            vmError: -765,
          }
        : undefined,
    })),
  };
  return {
    accounts,
    proofs: {
      generate: vi.fn(async () => ({ proof: new Uint8Array([9]) })),
    },
    transactions,
  };
}

describe("wallet deposit account helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("parses deposit routing once and exposes reusable lookups", () => {
    const parse = vi.spyOn(JSON, "parse");
    const depositConfig = createDepositConfig(RUNTIME_CONFIG);
    const config = depositConfig.getNetwork("devnet");

    expect(config.unifoldProject?.projectId).toBe("project_devnet");
    expect(config.providers.get("unifold")?.public.stripe_link_enabled).toBe(
      "true",
    );
    expect(config.providers.get("coinbase")).toEqual({
      kind: "coinbase_headless",
      enabled: true,
      public: {},
    });
    expect(depositConfig.getTarget("devnet", "credits").mintAddress).toBe(
      "ta_mint",
    );
    expect(parse).toHaveBeenCalledOnce();
  });

  it("treats supplied runtime config as authoritative, including an empty object", () => {
    vi.stubEnv(
      "NEXT_PUBLIC_THRU_DEPOSIT_NETWORK_CONFIG_JSON",
      RUNTIME_CONFIG.networkConfigJson,
    );
    vi.stubEnv("NEXT_PUBLIC_THRU_DEPOSIT_DEFAULT_NETWORK", "devnet");

    expect(createDepositConfig().getNetwork().network).toBe("devnet");
    expect(() => createDepositConfig({}).getNetwork()).toThrow(
      "NEXT_PUBLIC_THRU_DEPOSIT_NETWORK_CONFIG_JSON is not configured for deposits",
    );
  });

  it("returns zero balance when the configured account is missing", async () => {
    const thru = createThru({ tokenExists: false });

    const state = await getDepositAccountStateForWallet({
      thru: thru as never,
      walletAddress: "ta_wallet",
      destination: DESTINATION,
    });

    expect(state).toEqual({
      destination: DESTINATION,
      balanceRaw: 0n,
      balanceLabel: "0",
    });
  });

  it("skips setup when the deposit account already exists", async () => {
    const thru = createThru({ tokenExists: true, balanceRaw: 42n });
    const signTransaction = vi.fn();

    const state = await ensureDepositAccountForWallet({
      thru: thru as never,
      walletAddress: "ta_wallet",
      destination: DESTINATION,
      signTransaction,
    });

    expect(signTransaction).not.toHaveBeenCalled();
    expect(thru.transactions.send).not.toHaveBeenCalled();
    expect(state.balanceRaw).toBe(42n);
  });

  it("creates the deposit account when it is missing", async () => {
    const thru = createThru({ tokenExists: false, balanceRaw: 0n });
    const signTransaction = vi.fn(async () => "AQID");

    const state = await ensureDepositAccountForWallet({
      thru: thru as never,
      walletAddress: "ta_wallet",
      destination: DESTINATION,
      signTransaction,
    });

    expect(signTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        walletAddress: "ta_wallet",
        programAddress: DESTINATION.tokenProgramAddress,
      }),
    );
    expect(thru.transactions.send).toHaveBeenCalledOnce();
    expect(state.lastSetupSignature).toBe("ts_setup");
  });

  it("uses the active signing session for deposit setup", async () => {
    const signTransaction = vi.fn(async () => "AQID");
    const thru = {
      getSigningSessions: vi.fn(async () => [
        { id: "session-other", walletAddress: "ta_other", authIdx: 1 },
        { id: "session-wallet", walletAddress: "ta_wallet", authIdx: 1 },
      ]),
      signTransaction,
    };
    const payload = {
      trailingInstructionData: "AQID",
      walletAddress: "ta_wallet",
      readWriteAddresses: ["ta_token_account"],
      readOnlyAddresses: ["ta_token_program", "ta_mint"],
      programAddress: "ta_token_program",
      review: {
        appName: "Thru Wallet",
        instruction: "initialize_token_account(symbol: CREDITS)",
      },
    };

    await expect(
      signDepositTransactionWithActiveSession(thru as never, payload),
    ).resolves.toBe("AQID");
    expect(signTransaction).toHaveBeenCalledWith({
      walletAddress: payload.walletAddress,
      programAddress: payload.programAddress,
      instructionData: payload.trailingInstructionData,
      readWriteAddresses: payload.readWriteAddresses,
      readOnlyAddresses: payload.readOnlyAddresses,
      review: payload.review,
      signingSessionId: "session-wallet",
    });
  });

  it("preserves passkey signing when no wallet session is active", async () => {
    const signTransaction = vi.fn(async () => "AQID");
    const thru = {
      getSigningSessions: vi.fn(async () => [
        { id: "session-provisional", walletAddress: "ta_wallet", authIdx: -1 },
        { id: "session-other", walletAddress: "ta_other", authIdx: 1 },
      ]),
      signTransaction,
    };

    await signDepositTransactionWithActiveSession(thru as never, {
      trailingInstructionData: "AQID",
      walletAddress: "ta_wallet",
      readWriteAddresses: ["ta_token_account"],
      readOnlyAddresses: ["ta_token_program", "ta_mint"],
      programAddress: "ta_token_program",
    });

    expect(signTransaction).toHaveBeenCalledWith(
      expect.not.objectContaining({ signingSessionId: expect.anything() }),
    );
  });

  it("resolves once the balance reaches the minimum", async () => {
    const thru = createThru({ tokenExists: true, balanceRaw: 10n });
    const onAttempt = vi.fn();

    const state = await waitForDepositBalanceForWallet({
      thru: thru as never,
      walletAddress: "ta_wallet",
      destination: DESTINATION,
      minimumBalanceRaw: 10n,
      onAttempt,
    });

    expect(state.balanceRaw).toBe(10n);
    expect(onAttempt).toHaveBeenCalledOnce();
    expect(onAttempt).toHaveBeenCalledWith(1);
  });

  it("does not let an observation callback break balance polling", async () => {
    const thru = createThru({ tokenExists: true, balanceRaw: 10n });

    await expect(
      waitForDepositBalanceForWallet({
        thru: thru as never,
        walletAddress: "ta_wallet",
        destination: DESTINATION,
        minimumBalanceRaw: 10n,
        onAttempt: () => {
          throw new Error("telemetry failed");
        },
      }),
    ).resolves.toMatchObject({ balanceRaw: 10n });
  });

  it("stops the balance poll window when it is cancelled", async () => {
    vi.useFakeTimers();
    const thru = createThru({ tokenExists: true, balanceRaw: 0n });
    const controller = new AbortController();
    const onAttempt = vi.fn();

    const wait = waitForDepositBalanceForWallet({
      thru: thru as never,
      walletAddress: "ta_wallet",
      destination: DESTINATION,
      minimumBalanceRaw: 1n,
      signal: controller.signal,
      onAttempt,
    });
    const rejection = expect(wait).rejects.toMatchObject({
      name: "AbortError",
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(onAttempt).toHaveBeenCalledOnce();
    expect(thru.accounts.get).toHaveBeenCalledOnce();

    controller.abort();
    await rejection;
    await vi.advanceTimersByTimeAsync(10_000);

    expect(onAttempt).toHaveBeenCalledOnce();
    expect(thru.accounts.get).toHaveBeenCalledOnce();
  });

  it("does not start a balance read when already cancelled", async () => {
    const thru = createThru({ tokenExists: true, balanceRaw: 10n });
    const controller = new AbortController();
    controller.abort();

    await expect(
      waitForDepositBalanceForWallet({
        thru: thru as never,
        walletAddress: "ta_wallet",
        destination: DESTINATION,
        minimumBalanceRaw: 1n,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(thru.accounts.get).not.toHaveBeenCalled();
  });

  it("throws the transaction failure while polling by signature", async () => {
    const thru = createThru({ tokenExists: false, failedSignature: true });

    await expect(
      waitForDepositBalanceForWallet({
        thru: thru as never,
        walletAddress: "ta_wallet",
        destination: DESTINATION,
        minimumBalanceRaw: 1n,
        signature: "ts_failed",
      }),
    ).rejects.toBeInstanceOf(DepositTransactionError);
  });
});
