import type {
  AddressType as AddressTypeValue,
  ConnectResult,
  IThruChain,
  WalletAccount,
} from '@thru/chain-interfaces';
import { AddressType } from '@thru/chain-interfaces';
import { EmbeddedProvider } from '@thru/embedded-provider';
import { EMBEDDED_PROVIDER_EVENTS, type ConnectMetadataInput } from '@thru/protocol';
import { createThruClient, Thru } from '@thru/thru-sdk/client';

export interface BrowserSDKConfig {
  iframeUrl?: string;
  addressTypes?: AddressTypeValue[];
  rpcUrl?: string;
}

export interface ConnectOptions {
  metadata?: ConnectMetadataInput;
}

export type SDKEvent = 'connect' | 'disconnect' | 'lock' | 'error' | 'accountChanged';

export type EventCallback = (...args: any[]) => void;

/**
 * Browser SDK - Main entry point for dApp developers
 * Wraps EmbeddedProvider with a clean, simple API
 */
export class BrowserSDK {
  private provider: EmbeddedProvider;
  private eventListeners = new Map<SDKEvent, Set<EventCallback>>();
  private initialized = false;
  private thruClient: Thru;
  private connectInFlight: Promise<ConnectResult> | null = null;
  private lastConnectResult: ConnectResult | null = null;

  constructor(config: BrowserSDKConfig = {}) {
    this.provider = new EmbeddedProvider({
      iframeUrl: config.iframeUrl,
      addressTypes: config.addressTypes || [AddressType.THRU],
    });

    this.thruClient = createThruClient({
      baseUrl: config.rpcUrl,
    });

    // Forward provider events to SDK events
    this.setupEventForwarding();
  }

  /**
   * Initialize the SDK (creates iframe)
   * Must be called before using the SDK
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.provider.initialize();
    this.initialized = true;
  }

  /**
   * Connect to wallet
   * Shows wallet modal and requests connection
   */
  async connect(options?: ConnectOptions): Promise<ConnectResult> {
    // Auto-initialize if not done yet
    if (!this.initialized) {
      await this.initialize();
    }

    if (this.connectInFlight) {
      return this.connectInFlight;
    }

    if (this.lastConnectResult && this.provider.isConnected()) {
      return this.lastConnectResult;
    }

    this.emit('connect', { status: 'connecting' });

    const inFlight = (async () => {
      try {
        const metadata = this.resolveMetadata(options?.metadata);
        const providerOptions = metadata ? { metadata } : undefined;
        const result = await this.provider.connect(providerOptions);
        this.lastConnectResult = result;
        this.emit('connect', result);
        return result;
      } catch (error) {
        this.emit('error', error);
        throw error;
      } finally {
        this.connectInFlight = null;
      }
    })();

    this.connectInFlight = inFlight;
    return inFlight;
  }

  /**
   * Disconnect from wallet
   */
  async disconnect(): Promise<void> {
    try {
      await this.provider.disconnect();
      this.emit('disconnect', {});
      this.lastConnectResult = null;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.provider.isConnected();
  }

  /**
   * Get all accounts
   */
  getAccounts(): WalletAccount[] {
    const accounts = this.provider.getAccounts();
    this.refreshCachedAccounts(accounts);
    return accounts;
  }

  getSelectedAccount(): WalletAccount | null {
    return this.provider.getSelectedAccount();
  }

  async selectAccount(publicKey: string): Promise<WalletAccount> {
    const account = await this.provider.selectAccount(publicKey);
    this.refreshCachedAccounts(this.provider.getAccounts(), account);
    return account;
  }

  /**
   * Get Thru chain API (iframe-backed signer)
   */
  get thru(): IThruChain {
    return this.provider.thru;
  }

  /**
   * Event emitter: on
   */
  on(event: SDKEvent, callback: EventCallback): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
  }

  /**
   * Event emitter: off
   */
  off(event: SDKEvent, callback: EventCallback): void {
    this.eventListeners.get(event)?.delete(callback);
  }

  /**
   * Event emitter: once (listen once and auto-remove)
   */
  once(event: SDKEvent, callback: EventCallback): void {
    const wrappedCallback = (...args: any[]) => {
      callback(...args);
      this.off(event, wrappedCallback);
    };
    this.on(event, wrappedCallback);
  }

  /**
   * Emit event to all listeners
   */
  private emit(event: SDKEvent, data?: any): void {
    this.eventListeners.get(event)?.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error in SDK event listener for ${event}:`, error);
      }
    });
  }

  /**
   * Set up event forwarding from provider to SDK
   */
  private setupEventForwarding(): void {
    // Forward all relevant provider events to SDK events
    this.provider.on(EMBEDDED_PROVIDER_EVENTS.CONNECT, (data: any) => {
      // Already handled in connect() method
    });

    this.provider.on(EMBEDDED_PROVIDER_EVENTS.DISCONNECT, (data: any) => {
      this.emit('disconnect', data);
    });

    this.provider.on(EMBEDDED_PROVIDER_EVENTS.ERROR, (data: any) => {
      this.emit('error', data);
    });

    this.provider.on(EMBEDDED_PROVIDER_EVENTS.LOCK, (data: any) => {
      this.emit('lock', data);
      this.emit('disconnect', { reason: 'locked' });
    });

    this.provider.on(EMBEDDED_PROVIDER_EVENTS.ACCOUNT_CHANGED, (data: any) => {
      const account = data?.account ?? data;
      this.refreshCachedAccounts(this.provider.getAccounts(), account ?? null);
      this.emit('accountChanged', account);
    });
  }

  /**
   * Destroy SDK and cleanup
   */
  destroy(): void {
    this.provider.destroy();
    this.eventListeners.clear();
    this.initialized = false;
    this.connectInFlight = null;
    this.lastConnectResult = null;
  }

  private resolveMetadata(input?: ConnectMetadataInput): ConnectMetadataInput | undefined {
    const defaultOrigin = typeof window !== 'undefined' ? window.location.origin : undefined;
    if (!defaultOrigin && !input) {
      return undefined;
    }

    const appId = input?.appId || defaultOrigin;
    const appUrl = this.resolveAppUrl(defaultOrigin, input?.appUrl);
    const appName = input?.appName || this.deriveAppName(appUrl ?? appId);

    const metadata: ConnectMetadataInput = {};
    if (appId) metadata.appId = appId;
    if (appUrl) metadata.appUrl = appUrl;
    if (appName) metadata.appName = appName;
    if (input?.imageUrl) metadata.imageUrl = input.imageUrl;

    return metadata;
  }

  private resolveAppUrl(defaultOrigin?: string, providedUrl?: string): string | undefined {
    const candidate = providedUrl || defaultOrigin;
    if (!candidate) {
      return undefined;
    }

    try {
      const url = new URL(candidate, defaultOrigin);
      return url.toString();
    } catch {
      return defaultOrigin;
    }
  }

  private deriveAppName(source?: string): string | undefined {
    if (!source) {
      return undefined;
    }

    try {
      const hostname = new URL(source).hostname;
      return hostname || source;
    } catch {
      return source;
    }
  }

  public getThru(): Thru {
    return this.thruClient;
  }

  private refreshCachedAccounts(accounts: WalletAccount[], selectedAccount?: WalletAccount | null): void {
    let nextAccounts = accounts;

    if (selectedAccount) {
      const hasAccount = accounts.some(acc => acc.address === selectedAccount.address);
      if (!hasAccount) {
        nextAccounts = [...accounts, selectedAccount];
      }
    }

    if (this.lastConnectResult) {
      this.lastConnectResult = {
        ...this.lastConnectResult,
        accounts: nextAccounts,
      };
    }
  }
}
