import * as React from "react";
import { Dialog } from "@base-ui/react/dialog";
import { cn } from "../../../utils";
import "../island.css";
import "./WalletOverlay.css";

export interface WalletOverlayProps {
  open: boolean;
  /** Scrim click or Escape. */
  onClose?: () => void;
  /** Close when the scrim is clicked (default true). */
  closeOnScrim?: boolean;
  /** Close on Escape (default true). */
  closeOnEscape?: boolean;
  /**
   * Portal target. When set, the overlay positions itself inside this element
   * (which should be `position: relative`) instead of the viewport — for a
   * demo stage. Accepts an element or a ref to one.
   */
  container?: HTMLElement | null | React.RefObject<HTMLElement | null>;
  "aria-label"?: string;
  className?: string;
  /** The `WalletSheet.Root` (or any `Frame`). */
  children: React.ReactNode;
}

/**
 * WalletOverlay — the top-center presentation of the wallet sheet: a light
 * scrim and a popup that grows out of a pill "island" (and collapses back on
 * close). Built on Base UI `Dialog` for the portal, Escape handling, and the
 * enter / exit style hooks.
 *
 * It is deliberately **non-modal**: the real sign-in and signing ceremonies
 * happen in the hosted wallet iframe, which must stay interactive while this
 * sheet shows the waiting state. Focus is not trapped, scroll is not locked,
 * and dismissal is handled here (scrim click / Escape) rather than by Base UI
 * outside-press detection.
 */
export function WalletOverlay({
  open,
  onClose,
  closeOnScrim = true,
  closeOnEscape = true,
  container,
  "aria-label": ariaLabel = "Thru Wallet",
  className,
  children,
}: WalletOverlayProps) {
  const contained = container != null;
  /* Focus the sheet itself on open rather than its first control (the close
     button), so nothing starts with a focus ring. */
  const popupRef = React.useRef<HTMLDivElement>(null);
  return (
    <Dialog.Root
      open={open}
      modal={false}
      disablePointerDismissal
      onOpenChange={(next, details) => {
        if (next) return;
        if (details.reason === "escape-key" && !closeOnEscape) return;
        onClose?.();
      }}
    >
      <Dialog.Portal container={container}>
        <Dialog.Backdrop
          className={cn("tds-woverlay__scrim", contained && "tds-woverlay__scrim--contained")}
          onClick={closeOnScrim ? () => onClose?.() : undefined}
        />
        <Dialog.Popup
          ref={popupRef}
          initialFocus={popupRef}
          className={cn("tds-woverlay", contained && "tds-woverlay--contained", className)}
          aria-label={ariaLabel}
        >
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
