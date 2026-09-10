/**
 * The wallet button frame: a small wallet-served page (`<iframeUrl>/button`)
 * that draws the dapp's sign-in button / account chip, so the control the
 * user clicks is wallet-owned end to end. The host drives its state and gets
 * its size and clicks back; the button never handles wallet requests itself.
 */

export const WALLET_BUTTON_PATH_SEGMENT = "button";

export const WALLET_BUTTON_MESSAGES = {
  /** frame → host: the page is listening; the host answers with STATE. */
  READY: "wallet-button:ready",
  /** host → frame: what to draw. */
  STATE: "wallet-button:state",
  /** frame → host: the drawn control's size, so the host sizes the iframe. */
  SIZE: "wallet-button:size",
  /** frame → host: the control was clicked (with its rect inside the frame). */
  CLICK: "wallet-button:click",
} as const;

export type WalletButtonVisualState = "idle" | "loading" | "connected";

export interface WalletButtonState {
  state: WalletButtonVisualState;
  size?: "md" | "sm" | "xs";
  variant?: "primary" | "outline" | "brick";
  label?: string;
  loadingLabel?: string;
  address?: string;
  balance?: string;
  showBalance?: boolean;
  network?: string;
  /** Matches the host page so the control does not stand out. */
  theme?: "light" | "dark";
  /** The account menu is open: the chip shows its pressed look. */
  menuOpen?: boolean;
  /** Stretch the control to the frame's width (the host sizes the frame). */
  fullWidth?: boolean;
}

export interface WalletButtonRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WalletButtonReadyMessage {
  type: typeof WALLET_BUTTON_MESSAGES.READY;
  frameId: string;
}

export interface WalletButtonStateMessage {
  type: typeof WALLET_BUTTON_MESSAGES.STATE;
  frameId: string;
  state: WalletButtonState;
}

export interface WalletButtonSizeMessage {
  type: typeof WALLET_BUTTON_MESSAGES.SIZE;
  frameId: string;
  width: number;
  height: number;
}

export interface WalletButtonClickMessage {
  type: typeof WALLET_BUTTON_MESSAGES.CLICK;
  frameId: string;
  state: WalletButtonVisualState;
  /** The control's rect inside the frame (host adds the frame's own rect). */
  rect: WalletButtonRect;
}

/** `<iframeUrl>/button`, keeping the wallet URL's query (signing scheme, telemetry). */
export function resolveWalletButtonUrl(iframeUrl: string): string {
  const url = new URL(iframeUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${WALLET_BUTTON_PATH_SEGMENT}`;
  return url.toString();
}
