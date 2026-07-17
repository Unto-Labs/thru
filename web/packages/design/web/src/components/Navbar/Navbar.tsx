import * as React from "react";
import { cn } from "../../utils";
import { Dialog } from "../Dialog/Dialog";
import "./Navbar.css";

/**
 * Navbar — the Thru "scan" top bar, exposed as styled parts (compose freely).
 * Dark Ink ground, italic `thru` wordmark + a mono tag, mono section items with
 * a brick active-underline, and a status chip with a pulsing live dot. Parts
 * take a `render` element so the consumer can supply routing links / an
 * interactive switcher button without the component owning that coupling.
 *
 *   <Navbar.Root>
 *     <Navbar.Brand tag="scan" render={<Link href="/" />} />
 *     <Navbar.Nav>
 *       <Navbar.Item active render={<Link href="/" />}>Home</Navbar.Item>
 *       <Navbar.Item render={<button onClick={…} />}>Blocks</Navbar.Item>
 *     </Navbar.Nav>
 *     <Navbar.Spacer />
 *     <Navbar.Status network="thru-devnet" slot="59,421" connected />
 *   </Navbar.Root>
 */

const Root = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  function NavbarRoot({ className, ...props }, ref) {
    return <nav ref={ref} className={cn("tds-navbar", className)} {...props} />;
  },
);

export interface NavbarBrandProps extends React.HTMLAttributes<HTMLElement> {
  /** Mono tag shown after the wordmark (default "scan"). Pass null to hide. */
  tag?: React.ReactNode;
  /** A link element (e.g. a Next `<Link/>`) to wrap the brand. */
  render?: React.ReactElement;
  /** Override the wordmark — e.g. a logo lockup `<img>`/`<Image>`. Defaults to
   *  the italic `thru` text wordmark. */
  children?: React.ReactNode;
}
function Brand({
  tag = "scan",
  render,
  className,
  children,
  ...props
}: NavbarBrandProps) {
  const content = (
    <>
      {children ?? <span className="tds-navbar__wordmark">thru</span>}
      {tag != null && <span className="tds-navbar__tag">{tag}</span>}
    </>
  );
  const cls = cn("tds-navbar__brand", className);
  if (render) {
    return React.cloneElement(
      render as React.ReactElement<{ className?: string }>,
      { className: cls, ...props },
      content,
    );
  }
  return (
    <div className={cls} {...props}>
      {content}
    </div>
  );
}

function Nav({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("tds-navbar__nav", className)} {...props} />;
}

export interface NavbarItemProps extends React.HTMLAttributes<HTMLElement> {
  active?: boolean;
  /** A link/button element to render as (e.g. a Next `<Link/>`). */
  render?: React.ReactElement;
}
function Item({ active, render, className, children, ...props }: NavbarItemProps) {
  const cls = cn("tds-navbar__item", className);
  const activeAttr = active ? { "data-active": "" } : {};
  if (render) {
    return React.cloneElement(
      render as React.ReactElement<{ className?: string }>,
      { className: cls, ...activeAttr, ...props },
      children,
    );
  }
  return (
    <button type="button" className={cls} {...activeAttr} {...props}>
      {children}
    </button>
  );
}

function Spacer({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("tds-navbar__spacer", className)} {...props} />;
}

export interface NavbarBurgerProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {}
/** Hamburger button — hidden on desktop, shown on mobile (see Navbar.css).
 *  Pass it as `Navbar.Drawer`'s `trigger` so it toggles the menu. */
const Burger = React.forwardRef<HTMLButtonElement, NavbarBurgerProps>(
  function NavbarBurger({ className, "aria-label": ariaLabel = "Toggle menu", ...props }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        className={cn("tds-navbar__burger", className)}
        aria-label={ariaLabel}
        {...props}
      >
        <svg width="20" height="14" viewBox="0 0 20 14" fill="none" aria-hidden="true">
          <path
            d="M1 1h18M1 7h18M1 13h18"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    );
  },
);

export interface NavbarDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The burger (or other toggle) — rendered as the Dialog trigger so a click
   *  on it toggles rather than fighting the outside-press dismissal. */
  trigger: React.ReactElement;
  /** Accessible name for the menu panel. */
  "aria-label"?: string;
  /** Menu content, stacked (typically the same `Navbar.Item`s as the bar). */
  children?: React.ReactNode;
}
/** Mobile nav menu — a full-width panel that slides down from under the bar
 *  (thru.org's mobile dropdown pattern), built on the design-system `Dialog`
 *  (focus-trap, scrim, `Esc`, and scroll-lock come from Base UI). */
function Drawer({
  open,
  onOpenChange,
  trigger,
  "aria-label": ariaLabel = "Menu",
  children,
}: NavbarDrawerProps) {
  /* Focus the panel itself on open — autofocusing the first tabbable (the
     search field) would pop the keyboard on every open on real phones. */
  const popupRef = React.useRef<HTMLElement>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger render={trigger} />
      <Dialog.Portal>
        <Dialog.Backdrop className="tds-navbar__scrim" />
        <Dialog.Popup
          ref={popupRef}
          initialFocus={popupRef}
          aria-label={ariaLabel}
          className="tds-navbar__drawer"
        >
          <div className="tds-navbar__drawer-nav">{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export interface NavbarStatusProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "slot"> {
  network?: React.ReactNode;
  slot?: React.ReactNode;
  /** Live (green) vs offline (grey) dot. */
  connected?: boolean;
  /** Animate the live-pulse ring (only when connected). */
  pulse?: boolean;
  /** A button element to render as — makes the chip an interactive trigger. */
  render?: React.ReactElement;
}
function Status({
  network,
  slot,
  connected = true,
  pulse = true,
  render,
  className,
  ...props
}: NavbarStatusProps) {
  const content = (
    <>
      <span className={cn("tds-navbar__dot", !connected && "tds-navbar__dot--off")}>
        {connected && pulse && <span className="tds-navbar__dot-pulse" />}
        <span className="tds-navbar__dot-core" />
      </span>
      {network != null && (
        <span className="tds-navbar__status-net" suppressHydrationWarning>
          {network}
        </span>
      )}
      {slot != null && (
        <span className="tds-navbar__status-slot" suppressHydrationWarning>
          · slot #{slot}
        </span>
      )}
    </>
  );
  const cls = cn("tds-navbar__status", className);
  if (render) {
    return React.cloneElement(
      render as React.ReactElement<{ className?: string }>,
      { className: cls, ...props },
      content,
    );
  }
  return (
    <div className={cls} {...props}>
      {content}
    </div>
  );
}

export const Navbar = { Root, Brand, Nav, Item, Spacer, Status, Burger, Drawer };
