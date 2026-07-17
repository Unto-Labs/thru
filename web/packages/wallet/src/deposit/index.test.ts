import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DepositTarget,
  ThruNetwork,
  type DepositDestination,
} from "../protocol";
import {
  DepositTransactionError,
  createDepositConfig,
  type DepositRuntimeConfig,
  ensureDepositAccountForWallet,
  getDepositAccountStateForWallet,
  waitForDepositBalanceForWallet,
} from "./index";

vi.mock("@thru/sdk/helpers", () => ({
  decodeAddress: vi.fn((address: string) => new Uint8Array([address.length])),
}));

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
      unifold_project: {
        project_id: "project_devnet",
        publishable_key: "pk_devnet",
        treasury_address: "treasury_devnet",
        destination_token_address: "usdc_devnet",
      },
      default_deposit_target: "credits",
      deposit_targets: {
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
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("parses deposit routing once and exposes reusable lookups", () => {
    const parse = vi.spyOn(JSON, "parse");
    const depositConfig = createDepositConfig(RUNTIME_CONFIG);
    const config = depositConfig.getNetwork("devnet");

    expect(config.unifoldProject.projectId).toBe("project_devnet");
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

  it("resolves once the balance reaches the minimum", async () => {
    const thru = createThru({ tokenExists: true, balanceRaw: 10n });

    const state = await waitForDepositBalanceForWallet({
      thru: thru as never,
      walletAddress: "ta_wallet",
      destination: DESTINATION,
      minimumBalanceRaw: 10n,
    });

    expect(state.balanceRaw).toBe(10n);
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
