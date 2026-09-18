'use client';

/* WalletButton — the dapp's sign-in button / account chip, drawn by the
 * wallet inside a small iframe so the control is wallet-owned end to end.
 * This wrapper sizes the frame from what the wallet reports, feeds it the
 * connection state, hands an idle click to the host's connect flow, and
 * opens the wallet-drawn account menu (anchored to the frame) on a chip
 * click. It has no look of its own. */

import type { CSSProperties } from 'react';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ThruContext } from './ThruContext';
import { useWalletTheme } from './useWalletTheme';
import {
  DEFAULT_IFRAME_URL,
  WALLET_BUTTON_MESSAGES,
  createRequestId,
  resolveWalletButtonUrl,
  type WalletButtonClickMessage,
  type WalletButtonSizeMessage,
  type WalletButtonState,
  type WalletButtonStateMessage,
} from '../protocol';

const PARENT_ORIGIN_SEARCH_PARAM = 'tn_parent_origin';
const FRAME_ID_SEARCH_PARAM = 'tn_frame_id';
const RELOAD_SEARCH_PARAM = 'tn_reload';
const READY_WATCHDOG_BASE_MS = 8_000;
const READY_WATCHDOG_MAX_ATTEMPTS = 3;

/** How long to wait for the button frame's ready before forcing reload number `attempt + 1`; null once out of attempts. */
export function walletButtonReloadDelayMs(attempt: number): number | null {
  if (attempt >= READY_WATCHDOG_MAX_ATTEMPTS) return null;
  return READY_WATCHDOG_BASE_MS * 2 ** attempt;
}

export interface WalletButtonProps {
  size?: WalletButtonState['size'];
  variant?: WalletButtonState['variant'];
  /** Idle label (wallet default "Sign in with Thru"). */
  label?: string;
  loadingLabel?: string;
  /** Formatted balance for the connected chip, as the host displays it. */
  balance?: string;
  showBalance?: boolean;
  /** Network label for the chip's menu header, e.g. "alphanet". */
  network?: string;
  /** Explorer page of the connected account, for the menu. */
  explorerUrl?: string;
  /** Pin this button and its menu to a scheme (default: follow the SDK's theme, live). */
  theme?: 'light' | 'dark';
  /** Which edge of the chip the menu aligns to (default right). */
  menuAlign?: 'left' | 'right';
  /** Stretch to the container's width (a form CTA). */
  fullWidth?: boolean;
  /** Idle click: start the host's connect flow (it owns the metadata). */
  onConnect?: () => void;
  /** A wallet error while opening the menu. */
  onError?: (error: unknown) => void;
  /** Override the wallet URL the frame loads from (defaults to the SDK's). */
  iframeUrl?: string;
  className?: string;
  style?: CSSProperties;
}

interface FrameSize {
  width: number;
  height: number;
}

export function WalletButton({
  size = 'md',
  variant = 'primary',
  label,
  loadingLabel,
  balance,
  showBalance = true,
  network,
  explorerUrl,
  theme: themeProp,
  menuAlign = 'right',
  fullWidth = false,
  onConnect,
  onError,
  iframeUrl,
  className,
  style,
}: WalletButtonProps) {
  const {
    wallet,
    isConnected,
    isConnecting,
    selectedAccount,
    openAccountMenu,
    deposit,
    ensureDepositAccount,
  } = useContext(ThruContext);
  const frameId = useMemo(() => createRequestId('btn'), []);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);
  /* Reloads of the button frame forced by the ready watchdog (see below). */
  const [reloadAttempt, setReloadAttempt] = useState(0);
  const [frameSize, setFrameSize] = useState<FrameSize | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  /* The frame URL carries the host origin, so the iframe is client-only. */
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const sdkTheme = useWalletTheme(wallet);
  const theme = themeProp ?? sdkTheme;
  const baseUrl = iframeUrl ?? wallet?.getIframeUrl() ?? DEFAULT_IFRAME_URL;
  const buttonOrigin = useMemo(() => new URL(baseUrl).origin, [baseUrl]);
  const src = useMemo(() => {
    const url = new URL(resolveWalletButtonUrl(baseUrl));
    url.searchParams.set(FRAME_ID_SEARCH_PARAM, frameId);
    if (typeof window !== 'undefined' && window.location.origin) {
      url.searchParams.set(PARENT_ORIGIN_SEARCH_PARAM, window.location.origin);
    }
    if (reloadAttempt > 0) url.searchParams.set(RELOAD_SEARCH_PARAM, String(reloadAttempt));
    return url.toString();
  }, [baseUrl, frameId, reloadAttempt]);

  /* The frame has no size until the wallet reports one, so a load that never
     completes (a wallet server mid-restart, a very slow origin) leaves an
     invisible control. If the frame has not said ready in time, reload it —
     a few times, backing off — instead of staying blank until the host page
     is reloaded by hand. */
  useEffect(() => {
    if (!mounted || ready) return;
    const delay = walletButtonReloadDelayMs(reloadAttempt);
    if (delay === null) return;
    const timer = window.setTimeout(() => setReloadAttempt((n) => n + 1), delay);
    return () => window.clearTimeout(timer);
  }, [mounted, ready, reloadAttempt]);

  const address = selectedAccount?.address ?? '';
  const visualState: WalletButtonState['state'] =
    isConnected && address ? 'connected' : isConnecting ? 'loading' : 'idle';
  const state = useMemo<WalletButtonState>(
    () => ({
      state: visualState,
      size,
      variant,
      label,
      loadingLabel,
      address,
      balance,
      showBalance,
      network,
      theme,
      menuOpen,
      fullWidth,
    }),
    [
      visualState,
      size,
      variant,
      label,
      loadingLabel,
      address,
      balance,
      showBalance,
      network,
      theme,
      menuOpen,
      fullWidth,
    ]
  );

  const postState = useCallback(
    (next: WalletButtonState) => {
      const target = iframeRef.current?.contentWindow;
      if (!target) return;
      const message: WalletButtonStateMessage = {
        type: WALLET_BUTTON_MESSAGES.STATE,
        frameId,
        state: next,
      };
      try {
        target.postMessage(message, buttonOrigin);
      } catch {
        /* The frame is not on the wallet origin yet; READY will ask again. */
      }
    },
    [buttonOrigin, frameId]
  );

  /* Keep the frame's picture in step with the host. */
  useEffect(() => {
    if (ready) postState(state);
  }, [ready, state, postState]);

  const openMenu = useCallback(
    async (rect: WalletButtonClickMessage['rect']) => {
      const frameRect = iframeRef.current?.getBoundingClientRect();
      if (!frameRect) return;
      setMenuOpen(true);
      try {
        const result = await openAccountMenu({
          anchor: {
            x: frameRect.x + rect.x,
            y: frameRect.y + rect.y,
            width: rect.width,
            height: rect.height,
          },
          align: menuAlign,
          network,
          explorerUrl,
          balances: address && balance ? { [address]: balance } : undefined,
          /* Only a pinned scheme travels with the menu; otherwise the popup
             inherits the wallet document's theme and follows it live. */
          ...(themeProp ? { theme: themeProp } : {}),
        });
        /* "Add funds" in the wallet's menu: open the deposit sheet through the
           regular request so the host sees deposit:* events and the outcome.
           A fresh account has no deposit token account yet, and the sheet
           refuses to run without one, so create it first (the wallet asks the
           user to approve that transaction) — the same order a host's own
           Add funds button follows. */
        if (result.action === 'deposit') {
          setMenuOpen(false);
          await ensureDepositAccount();
          await deposit({ to: address || undefined });
        }
      } catch (error) {
        onError?.(error);
      } finally {
        setMenuOpen(false);
      }
    },
    [
      address,
      balance,
      deposit,
      ensureDepositAccount,
      explorerUrl,
      menuAlign,
      network,
      onError,
      openAccountMenu,
      themeProp,
    ]
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== buttonOrigin) return;
      const data = event.data as { type?: string; frameId?: string } | null;
      if (!data || data.frameId !== frameId) return;
      if (data.type === WALLET_BUTTON_MESSAGES.READY) {
        setReady(true);
        postState(state);
        return;
      }
      if (data.type === WALLET_BUTTON_MESSAGES.SIZE) {
        const { width, height } = data as WalletButtonSizeMessage;
        if (width > 0 && height > 0) setFrameSize({ width, height });
        return;
      }
      if (data.type === WALLET_BUTTON_MESSAGES.CLICK) {
        const click = data as WalletButtonClickMessage;
        if (click.state === 'idle') {
          onConnect?.();
        } else if (click.state === 'connected') {
          void openMenu(click.rect);
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [buttonOrigin, frameId, onConnect, openMenu, postState, state]);

  const frameStyle: CSSProperties = {
    display: fullWidth ? 'block' : 'inline-block',
    verticalAlign: 'middle',
    width: fullWidth ? '100%' : (frameSize?.width ?? 0),
    height: frameSize?.height ?? 0,
    border: 0,
    margin: 0,
    padding: 0,
    background: 'transparent',
    /* Chrome paints a cross-origin frame opaque when its color scheme differs
       from the document inside; the wallet page follows `theme`. */
    colorScheme: theme,
    overflow: 'hidden',
    ...style,
  };

  if (!mounted) return null;

  return (
    <iframe
      ref={iframeRef}
      src={src}
      title="Thru Wallet"
      className={className}
      style={frameStyle}
      scrolling="no"
    />
  );
}
