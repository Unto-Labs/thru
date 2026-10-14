import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmbeddedProvider } from './EmbeddedProvider';
import { IframeManager } from './IframeManager';
import type { BridgeNetworkState } from '../bridge-network-state';
import {
  DepositTarget,
  POST_MESSAGE_REQUEST_TYPES,
  ThruNetwork,
} from '../protocol';
import type {
  DepositDestination,
  DepositUiConfig,
  PostMessageRequest,
} from '../protocol';

const WALLET_URL = 'https://app.tid.sh/embedded';
const APP_ORIGIN = 'https://jcoin.example';
const DESTINATION: DepositDestination = {
  network: ThruNetwork.Alphanet,
  depositTarget: DepositTarget.THRUSD,
  tokenAccountAddress: 'ta_token_account',
  mintAddress: 'ta_mint',
  tokenProgramAddress: 'ta_token_program',
  symbol: 'THRUSD',
  decimals: 6,
};
const DEPOSIT_UI_CONFIG: DepositUiConfig = {
  appearance: 'dark',
  accentColor: '#0f766e',
  components: {
    button: { borderRadius: 8 },
  },
};

describe('deposit protocol round-trip', () => {
  beforeEach(() => {
    /* EmbeddedProvider.deposit() reads window.location.origin; the wallet iframe
       DOM is never created because sendMessage is stubbed. */
    (globalThis as unknown as { window: unknown }).window = {
      location: { origin: APP_ORIGIN },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it('sends a PREPARE_DEPOSIT request and resolves the destination', async () => {
    let captured: PostMessageRequest | null = null;
    vi.spyOn(IframeManager.prototype, 'sendMessage').mockImplementation(
      async (request: PostMessageRequest) => {
        captured = request;
        return {
          id: request.id,
          success: true,
          result: DESTINATION,
        } as never;
      }
    );

    const provider = new EmbeddedProvider({
      iframeUrl: WALLET_URL,
      network: ThruNetwork.Alphanet,
      depositUiConfig: DEPOSIT_UI_CONFIG,
    });
    const result = await provider.prepareDeposit(DepositTarget.THRUSD);

    expect(captured).not.toBeNull();
    expect(captured!.type).toBe(POST_MESSAGE_REQUEST_TYPES.PREPARE_DEPOSIT);
    expect(captured!.payload).toEqual({
      depositTarget: DepositTarget.THRUSD,
      network: ThruNetwork.Alphanet,
    });
    expect(result).toEqual(DESTINATION);
  });

  it('tags each deposit with the active network across Alphanet -> Betanet -> Alphanet switches', async () => {
    const captured: PostMessageRequest[] = [];
    let generation = 1;
    function report(provider: EmbeddedProvider, id: string, generation: number) {
      const network = {
        id,
        name: id,
        scope: `preset:${id}`,
        rpcUrl: `https://rpc.${id}.thru.org`,
        chainId: 1,
        custom: false,
        depositConfigured: true,
      };
      const manager = provider.getIframeManager() as unknown as {
        networkState: BridgeNetworkState;
      };
      manager.networkState.readReady({
        network,
        networkGeneration: generation,
        capabilities: { networkSwitching: true },
      });
      return network;
    }
    const provider = new EmbeddedProvider({
      iframeUrl: WALLET_URL,
      network: ThruNetwork.Alphanet,
    });
    vi.spyOn(IframeManager.prototype, 'showModal').mockImplementation(() => {});
    vi.spyOn(IframeManager.prototype, 'hide').mockImplementation(async () => {});
    vi.spyOn(IframeManager.prototype, 'sendMessage').mockImplementation(
      async (request: PostMessageRequest) => {
        captured.push(request);
        const result =
          request.type === POST_MESSAGE_REQUEST_TYPES.SWITCH_NETWORK
            ? report(provider, request.payload as string, ++generation)
            : request.type === POST_MESSAGE_REQUEST_TYPES.PREPARE_DEPOSIT
              ? DESTINATION
              : { status: 'cancelled' };
        return { id: request.id, success: true, result } as never;
      }
    );
    report(provider, 'alphanet', generation);

    await provider.deposit({ enabledProviders: [] });
    await provider.switchNetwork('betanet');
    await provider.prepareDeposit(DepositTarget.THRUSD);
    await provider.deposit({ enabledProviders: [] });
    await provider.switchNetwork('alphanet');
    await provider.deposit({ enabledProviders: [] });

    expect(
      captured
        .filter((request) => request.type === POST_MESSAGE_REQUEST_TYPES.DEPOSIT)
        .map((request) => request.payload.network)
    ).toEqual(['alphanet', 'betanet', 'alphanet']);
    expect(captured.find((request) =>
      request.type === POST_MESSAGE_REQUEST_TYPES.PREPARE_DEPOSIT
    )?.payload).toEqual({
      depositTarget: DepositTarget.THRUSD,
      network: 'betanet',
    });
  });

  it('falls back to the constructor network before the bridge reports a network', async () => {
    let captured: PostMessageRequest | null = null;
    vi.spyOn(IframeManager.prototype, 'sendMessage').mockImplementation(
      async (request: PostMessageRequest) => {
        captured = request;
        return {
          id: request.id,
          success: true,
          result: { status: 'cancelled' },
        } as never;
      }
    );
    vi.spyOn(IframeManager.prototype, 'showModal').mockImplementation(() => {});
    vi.spyOn(IframeManager.prototype, 'hide').mockImplementation(async () => {});
    const provider = new EmbeddedProvider({
      iframeUrl: WALLET_URL,
      network: ThruNetwork.Alphanet,
    });

    await provider.deposit({});

    expect(captured!.payload).toEqual({ network: 'alphanet' });
  });

  it('sends a DEPOSIT request with the prepared destination and resolves the result', async () => {
    let captured: PostMessageRequest | null = null;
    const sendMessage = vi
      .spyOn(IframeManager.prototype, 'sendMessage')
      .mockImplementation(async (request: PostMessageRequest) => {
        captured = request;
        return {
          id: request.id,
          success: true,
          result: {
            status: 'completed',
            mintedAmountRaw: '1500000',
            signature: 'ts_minttx',
            providerDepositId: 'exec_link_1',
          },
        } as never;
      });
    const showModal = vi
      .spyOn(IframeManager.prototype, 'showModal')
      .mockImplementation(() => {});
    const hide = vi
      .spyOn(IframeManager.prototype, 'hide')
      .mockImplementation(async () => {});

    const provider = new EmbeddedProvider({
      iframeUrl: WALLET_URL,
      network: ThruNetwork.Alphanet,
      depositUiConfig: DEPOSIT_UI_CONFIG,
    });
    const result = await provider.deposit({
      providerId: 'unifold',
      fundingMethod: 'stripe_link',
      destination: DESTINATION,
      paymentAmount: '25.00',
      contact: { email: 'person@example.com' },
    });

    expect(captured).not.toBeNull();
    expect(captured!.type).toBe(POST_MESSAGE_REQUEST_TYPES.DEPOSIT);
    expect(captured!.origin).toBe(APP_ORIGIN);
    expect(captured!.payload).toEqual({
      providerId: 'unifold',
      fundingMethod: 'stripe_link',
      destination: DESTINATION,
      paymentAmount: '25.00',
      contact: { email: 'person@example.com' },
      resolvedDepositUiConfig: DEPOSIT_UI_CONFIG,
    });
    expect(result).toEqual({
      status: 'completed',
      mintedAmountRaw: '1500000',
      signature: 'ts_minttx',
      providerDepositId: 'exec_link_1',
    });

    expect(showModal).toHaveBeenCalledOnce();
    expect(hide).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it('passes a prepared Coinbase deposit through to the wallet', async () => {
    let captured: PostMessageRequest | null = null;
    vi.spyOn(IframeManager.prototype, 'sendMessage').mockImplementation(
      async (request: PostMessageRequest) => {
        captured = request;
        return {
          id: request.id,
          success: true,
          result: { status: 'cancelled' },
        } as never;
      }
    );
    vi.spyOn(IframeManager.prototype, 'showModal').mockImplementation(() => {});
    vi.spyOn(IframeManager.prototype, 'hide').mockImplementation(async () => {});

    const provider = new EmbeddedProvider({
      iframeUrl: WALLET_URL,
      network: ThruNetwork.Alphanet,
    });
    await provider.deposit({
      providerId: 'coinbase',
      destination: DESTINATION,
      paymentAmount: '20.00',
      customer: {
        email: 'person@example.com',
        phoneNumber: '+12055550123',
        phoneNumberVerifiedAt: '2026-07-30T12:00:00.000Z',
        agreementAcceptedAt: '2026-07-30T12:00:00.000Z',
      },
    });

    expect(captured).not.toBeNull();
    expect(captured!.payload).toEqual({
      providerId: 'coinbase',
      destination: DESTINATION,
      paymentAmount: '20.00',
      customer: {
        email: 'person@example.com',
        phoneNumber: '+12055550123',
        phoneNumberVerifiedAt: '2026-07-30T12:00:00.000Z',
        agreementAcceptedAt: '2026-07-30T12:00:00.000Z',
      },
    });
  });

  it('round-trips a cancelled result and hides the modal', async () => {
    vi.spyOn(IframeManager.prototype, 'sendMessage').mockImplementation(
      async (request: PostMessageRequest) =>
        ({
          id: request.id,
          success: true,
          result: { status: 'cancelled' },
        }) as never
    );
    vi.spyOn(IframeManager.prototype, 'showModal').mockImplementation(() => {});
    const hide = vi
      .spyOn(IframeManager.prototype, 'hide')
      .mockImplementation(async () => {});

    const provider = new EmbeddedProvider({ iframeUrl: WALLET_URL });
    const result = await provider.deposit({
      providerId: 'unifold',
      destination: DESTINATION,
    });

    expect(result).toEqual({ status: 'cancelled' });
    expect(hide).toHaveBeenCalledOnce();
  });

  it('hides the modal and rejects when the wallet errors', async () => {
    vi.spyOn(IframeManager.prototype, 'sendMessage').mockRejectedValue(
      new Error('wallet exploded')
    );
    vi.spyOn(IframeManager.prototype, 'showModal').mockImplementation(() => {});
    const hide = vi
      .spyOn(IframeManager.prototype, 'hide')
      .mockImplementation(async () => {});

    const provider = new EmbeddedProvider({ iframeUrl: WALLET_URL });
    await expect(
      provider.deposit({
        providerId: 'unifold',
        destination: DESTINATION,
      })
    ).rejects.toThrow('wallet exploded');
    expect(hide).toHaveBeenCalledOnce();
  });
});
