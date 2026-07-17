import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmbeddedProvider } from './EmbeddedProvider';
import { IframeManager } from './IframeManager';
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
  depositTarget: DepositTarget.Credits,
  tokenAccountAddress: 'ta_token_account',
  mintAddress: 'ta_mint',
  tokenProgramAddress: 'ta_token_program',
  symbol: 'CREDITS',
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
      },
    );

    const provider = new EmbeddedProvider({
      iframeUrl: WALLET_URL,
      network: ThruNetwork.Alphanet,
      depositUiConfig: DEPOSIT_UI_CONFIG,
    });
    const result = await provider.prepareDeposit(DepositTarget.Credits);

    expect(captured).not.toBeNull();
    expect(captured!.type).toBe(POST_MESSAGE_REQUEST_TYPES.PREPARE_DEPOSIT);
    expect(captured!.payload).toEqual({
      depositTarget: DepositTarget.Credits,
      network: ThruNetwork.Alphanet,
    });
    expect(result).toEqual(DESTINATION);
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
          },
        } as never;
      });
    const showModal = vi
      .spyOn(IframeManager.prototype, 'showModal')
      .mockImplementation(() => {});
    const hide = vi
      .spyOn(IframeManager.prototype, 'hide')
      .mockImplementation(() => {});

    const provider = new EmbeddedProvider({
      iframeUrl: WALLET_URL,
      network: ThruNetwork.Alphanet,
      depositUiConfig: DEPOSIT_UI_CONFIG,
    });
    const result = await provider.deposit({
      destination: DESTINATION,
    });

    expect(captured).not.toBeNull();
    expect(captured!.type).toBe(POST_MESSAGE_REQUEST_TYPES.DEPOSIT);
    expect(captured!.origin).toBe(APP_ORIGIN);
    expect(captured!.payload).toEqual({
      destination: DESTINATION,
      network: ThruNetwork.Alphanet,
      resolvedDepositUiConfig: DEPOSIT_UI_CONFIG,
    });
    expect(result).toEqual({
      status: 'completed',
      mintedAmountRaw: '1500000',
      signature: 'ts_minttx',
    });

    expect(showModal).toHaveBeenCalledOnce();
    expect(hide).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it('round-trips a cancelled result and hides the modal', async () => {
    vi.spyOn(IframeManager.prototype, 'sendMessage').mockImplementation(
      async (request: PostMessageRequest) =>
        ({
          id: request.id,
          success: true,
          result: { status: 'cancelled' },
        }) as never,
    );
    vi.spyOn(IframeManager.prototype, 'showModal').mockImplementation(() => {});
    const hide = vi
      .spyOn(IframeManager.prototype, 'hide')
      .mockImplementation(() => {});

    const provider = new EmbeddedProvider({ iframeUrl: WALLET_URL });
    const result = await provider.deposit({
      destination: DESTINATION,
    });

    expect(result).toEqual({ status: 'cancelled' });
    expect(hide).toHaveBeenCalledOnce();
  });

  it('hides the modal and rejects when the wallet errors', async () => {
    vi.spyOn(IframeManager.prototype, 'sendMessage').mockRejectedValue(
      new Error('wallet exploded'),
    );
    vi.spyOn(IframeManager.prototype, 'showModal').mockImplementation(() => {});
    const hide = vi
      .spyOn(IframeManager.prototype, 'hide')
      .mockImplementation(() => {});

    const provider = new EmbeddedProvider({ iframeUrl: WALLET_URL });
    await expect(
      provider.deposit({
        destination: DESTINATION,
      }),
    ).rejects.toThrow('wallet exploded');
    expect(hide).toHaveBeenCalledOnce();
  });
});
