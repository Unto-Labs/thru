import {
  isTrustedCoinbasePaymentUrl,
  parseCoinbaseWebViewEvent,
  shouldCloseCoinbasePayment,
  supportsCoinbaseApplePay,
} from "./coinbase-webview";

export interface CoinbasePaymentHostState {
  active: boolean;
  payment: { id: number; url: string } | null;
}

/** Owns one payment WebView at a time. Callbacks carry its generation so an
 * unmounted provider cannot cancel or complete a later payment. */
export class CoinbasePaymentHost {
  private generation = 0;
  private committed = false;
  private state: CoinbasePaymentHostState = { active: false, payment: null };

  constructor(
    private readonly forward: (event: string) => void,
    private readonly onChange: (state: CoinbasePaymentHostState) => void,
  ) {}

  open(url: unknown, platform: string, version: number | string): void {
    if (typeof url !== "string" || !isTrustedCoinbasePaymentUrl(url)) return;
    if (this.state.active) return;
    if (platform !== "ios" || !supportsCoinbaseApplePay(platform, version)) {
      this.forward(
        JSON.stringify({
          eventName: "onramp_api.load_error",
          data: {
            errorCode:
              platform === "ios"
                ? "IOS_VERSION_UNSUPPORTED"
                : "APPLE_PAY_PLATFORM_UNSUPPORTED",
            errorMessage:
              platform === "ios"
                ? "Coinbase Apple Pay requires iOS 16 or later."
                : "Coinbase Apple Pay is only available in the iOS wallet.",
          },
        }),
      );
      return;
    }
    this.committed = false;
    this.setState({ active: true, payment: { id: ++this.generation, url } });
  }

  reset(): void {
    this.generation++;
    this.committed = false;
    this.setState({ active: false, payment: null });
  }

  cancel(id: number): void {
    if (!this.isCurrent(id) || this.committed) return;
    this.setState({ active: false, payment: null });
    this.forward(JSON.stringify({ eventName: "onramp_api.cancel", data: {} }));
  }

  receive(id: number, url: string, rawData: string): void {
    if (!this.isCurrent(id) || !isTrustedCoinbasePaymentUrl(url)) return;
    const event = parseCoinbaseWebViewEvent(rawData);
    if (!event) return;
    if (event.eventName === "onramp_api.commit_success") {
      if (this.committed) return;
      this.committed = true;
    }
    if (event.eventName === "onramp_api.cancel" && this.committed) return;
    if (shouldCloseCoinbasePayment(event.eventName)) {
      // A successful/closed payment stays shielded until the wallet settles
      // its deposit request. Errors return control to the wallet's retry UI.
      this.setState({
        active:
          event.eventName === "onramp_api.polling_success" ||
          event.eventName === "onramp_api.cancel",
        payment: null,
      });
    }
    this.forward(JSON.stringify(event));
  }

  loadError(id: number, message: string, errorCode: string): void {
    if (!this.isCurrent(id)) return;
    this.setState({ active: false, payment: null });
    this.forward(
      JSON.stringify({
        eventName: "onramp_api.load_error",
        data: { errorCode, errorMessage: message },
      }),
    );
  }

  private isCurrent(id: number): boolean {
    return this.state.payment?.id === id;
  }

  private setState(state: CoinbasePaymentHostState): void {
    this.state = state;
    this.onChange(state);
  }
}
