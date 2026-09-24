import type { ResolvedWalletNetwork } from './networks';
import type { IframeReadyData } from './protocol';

/** Network state and readiness shared by iframe and WebView transports. */
export class BridgeNetworkState {
  network: ResolvedWalletNetwork | null = null;
  generation = 0;
  supported = false;
  private waiters = new Set<(network: ResolvedWalletNetwork) => void>();

  constructor(
    private readonly rejectPending: () => void,
    private readonly onChanged: (network: ResolvedWalletNetwork) => void,
  ) {}

  waitForNetwork(scope: string, name?: string): Promise<void> {
    const matches = (network: ResolvedWalletNetwork | null) =>
      network?.scope === scope && (name === undefined || network.name === name);
    if (matches(this.network)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const ready = (network: ResolvedWalletNetwork) => {
        if (!matches(network)) return;
        clearTimeout(timer);
        this.waiters.delete(ready);
        resolve();
      };
      const timer = setTimeout(() => {
        this.waiters.delete(ready);
        reject(
          new Error(
            'Network switch timed out. Reopen the wallet to reconnect.',
          ),
        );
      }, 20000);
      this.waiters.add(ready);
    });
  }

  readReady(
    ready?: Pick<
      IframeReadyData,
      'network' | 'networkGeneration' | 'capabilities'
    >,
  ): void {
    this.supported = ready?.capabilities?.networkSwitching === true;
    if (
      !ready?.network ||
      (this.network?.scope === ready.network.scope &&
        this.generation === ready.networkGeneration)
    )
      return;
    if (this.network && this.generation !== ready.networkGeneration)
      this.rejectPending();
    this.network = ready.network;
    this.generation = ready.networkGeneration ?? 0;
    this.onChanged(ready.network);
    for (const waiter of this.waiters) waiter(ready.network);
  }
}
