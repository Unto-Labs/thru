import * as React from "react";
import { cn } from "../../utils";
import { Button } from "../Button/Button";
import { Spinner } from "../Spinner/Spinner";
import { Menu } from "../Menu/Menu";
import { ThruDisc } from "../wallet/Brand/Brand";
import {
  AccountAvatar,
  AccountMenuPopup,
  DEFAULT_MANAGE_ACCOUNTS_HREF,
  DEFAULT_MANAGE_HREF,
  shortenWalletAddress,
  type ConnectAccount,
} from "../wallet/AccountMenu/AccountMenu";
import "./ConnectButton.css";

export { shortenWalletAddress };
export type { ConnectAccount };

const ChevronDown = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
  </svg>
);

export type ConnectButtonState = "idle" | "loading" | "connected";
export type ConnectButtonSize = "md" | "sm" | "xs";
export type ConnectButtonVariant = "primary" | "outline" | "brick";

const ICON_PX: Record<ConnectButtonSize, number> = { md: 16, sm: 14, xs: 12 };

export interface ConnectButtonProps {
  /** Idle shows the sign-in button, loading spins it, connected shows the account chip. */
  state?: ConnectButtonState;
  size?: ConnectButtonSize;
  /** Idle-button look. `brick` is the brand-filled variant. */
  variant?: ConnectButtonVariant;
  /** Idle label (default "Sign in with Thru"). */
  label?: React.ReactNode;
  /** Loading label (default "Signing in…"). */
  loadingLabel?: React.ReactNode;
  /** Connected account address — truncated in the chip, copied in full. */
  address?: string;
  /** Formatted balance shown after the address (the current account's). */
  balance?: React.ReactNode;
  /** Hide the balance segment of the chip. */
  showBalance?: boolean;
  /** Account avatar in the chip; defaults to a sky disc. */
  avatar?: React.ReactNode;
  /**
   * Every account the wallet exposes. The one matching `address` is current;
   * the rest are offered under "Switch account". Balances / avatars given
   * here win over the top-level props for their account.
   */
  accounts?: ConnectAccount[];
  /** Wallet name in the menu header (default "Thru Wallet"). */
  walletName?: React.ReactNode;
  /** Network name shown opposite the wallet name, e.g. "mainnet". */
  network?: React.ReactNode;
  /** Sub-line auth method after the account name (default "passkey"). */
  authLabel?: React.ReactNode;
  /** "Manage your Thru Wallet" target; `null` hides it. */
  manageHref?: string | null;
  /** "Manage accounts" target; `null` hides it. */
  manageAccountsHref?: string | null;
  /** Explorer link for the account; omit to hide the item. */
  explorerHref?: string;
  /** Idle click — open the wallet sheet. */
  onClick?: () => void;
  /**
   * Connected click when the wallet renders the menu itself (inside its
   * iframe): receives the chip's viewport rect to anchor to. When set, no
   * menu is rendered here and the chip shows its open state while
   * `menuOpen` is true.
   */
  onOpenMenu?: (anchor: DOMRect) => void;
  /** "Switch account" pick. The chip swaps at once; the host completes the switch. */
  onSwitch?: (account: ConnectAccount, index: number) => void;
  /** "Add account"; omit to hide the item. */
  onAddAccount?: () => void;
  /** Menu "Sign out". */
  onDisconnect?: () => void;
  /** Label of the sign-out item (default "Sign out"). */
  disconnectLabel?: React.ReactNode;
  /** Which edge of the chip the menu aligns to. */
  menuAlign?: "left" | "right";
  defaultMenuOpen?: boolean;
  /**
   * Modal menu (default): the page behind it is inert while it is open and
   * an outside press only closes it. Turn off for a menu shown open on a
   * static page (a gallery example).
   */
  menuModal?: boolean;
  /** Controlled menu state. */
  menuOpen?: boolean;
  onMenuOpenChange?: (open: boolean) => void;
  /** Extra `Menu.Item`s inserted before the sign-out separator. */
  children?: React.ReactNode;
  className?: string;
}

/**
 * ConnectButton — one drop-in for every dapp. Idle shows the brand disc and
 * "Sign in with Thru"; while the wallet sheet is open it spins and reads
 * "Signing in…"; once connected it becomes the account chip (address ·
 * balance) with the account menu (`AccountMenuPopup`): manage the wallet on
 * app.tid.sh, switch accounts in one click, add one, open the explorer, or
 * sign out. With `onOpenMenu` the chip only reports its rect and the wallet
 * iframe draws the menu.
 *
 * The chip reuses the Navbar status-chip recipe (mono, hairline, square) and
 * the idle button is the design-system `Button`, so it sits naturally in any
 * host nav. The menu is Base UI `Menu` via the styled `Menu` parts.
 */
export const ConnectButton = React.forwardRef<HTMLElement, ConnectButtonProps>(
  function ConnectButton(
    {
      state = "idle",
      size = "md",
      variant = "primary",
      label,
      loadingLabel,
      address = "",
      balance,
      showBalance = true,
      avatar,
      accounts,
      walletName = "Thru Wallet",
      network,
      authLabel = "passkey",
      manageHref = DEFAULT_MANAGE_HREF,
      manageAccountsHref = DEFAULT_MANAGE_ACCOUNTS_HREF,
      explorerHref,
      onClick,
      onOpenMenu,
      onSwitch,
      onAddAccount,
      onDisconnect,
      disconnectLabel = "Sign out",
      menuAlign = "right",
      defaultMenuOpen = false,
      menuModal = true,
      menuOpen,
      onMenuOpenChange,
      children,
      className,
    },
    ref,
  ) {
    const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultMenuOpen);
    const open = menuOpen ?? uncontrolledOpen;
    const setOpen = React.useCallback(
      (next: boolean) => {
        setUncontrolledOpen(next);
        onMenuOpenChange?.(next);
      },
      [onMenuOpenChange],
    );
    /* A switch swaps the chip at once; the override lasts until the host
       catches up by passing the new address (or changes it otherwise). */
    const [override, setOverride] = React.useState<{ from: string; to: string } | null>(null);
    const iconPx = ICON_PX[size];

    if (state !== "connected") {
      const loading = state === "loading";
      return (
        <Button
          ref={ref}
          variant={variant === "brick" ? "secondary" : variant}
          size={size}
          className={cn(
            "tds-connect",
            `tds-connect--${variant}`,
            loading && "tds-connect--loading",
            className,
          )}
          onClick={loading ? undefined : onClick}
          aria-busy={loading || undefined}
        >
          {loading ? (
            <Spinner tone="inherit" style={{ width: iconPx, height: iconPx }} />
          ) : (
            <ThruDisc size={iconPx} />
          )}
          <span>{loading ? (loadingLabel ?? "Signing in…") : (label ?? "Sign in with Thru")}</span>
        </Button>
      );
    }

    const list: ConnectAccount[] =
      accounts && accounts.length > 0 ? accounts : [{ address, balance, avatar }];
    const currentAddress = override && override.from === address ? override.to : address;
    const currentIdx = Math.max(
      0,
      list.findIndex((a) => a.address === currentAddress),
    );
    const current = list[currentIdx];
    const currentAvatar = current.avatar ?? (current.address === address ? avatar : undefined);
    const currentBalance = current.balance ?? (current.address === address ? balance : undefined);
    const short = shortenWalletAddress(current.address);
    const chipClass = cn("tds-connect-chip", `tds-connect-chip--${size}`, className);
    const chipContent = (
      <>
        <span className="tds-connect-chip__avatar">
          {currentAvatar ?? <AccountAvatar account={current} size={iconPx} />}
        </span>
        <span className="tds-connect-chip__addr">{short}</span>
        {showBalance && currentBalance != null && (
          <>
            <span className="tds-connect-chip__sep" aria-hidden />
            <span className="tds-connect-chip__bal">{currentBalance}</span>
          </>
        )}
        <ChevronDown className="tds-connect-chip__chev" width={14} height={14} />
      </>
    );

    /* The wallet draws the menu: the chip just hands over its rect. */
    if (onOpenMenu) {
      return (
        <button
          ref={ref as React.Ref<HTMLButtonElement>}
          type="button"
          className={chipClass}
          aria-label={`Wallet ${short}`}
          aria-haspopup="menu"
          aria-expanded={!!menuOpen}
          data-popup-open={menuOpen ? "" : undefined}
          onClick={(event) => onOpenMenu(event.currentTarget.getBoundingClientRect())}
        >
          {chipContent}
        </button>
      );
    }

    const menuAccounts: ConnectAccount[] = list.map((account) =>
      account.address === address
        ? { ...account, balance: account.balance ?? balance, avatar: account.avatar ?? avatar }
        : account,
    );
    const handleSwitch = (account: ConnectAccount, index: number) => {
      setOverride({ from: address, to: account.address });
      setOpen(false);
      onSwitch?.(account, index);
    };

    return (
      <Menu.Root open={open} onOpenChange={(next) => setOpen(next)} modal={menuModal}>
        <Menu.Trigger
          ref={ref as React.Ref<HTMLButtonElement>}
          className={chipClass}
          aria-label={`Wallet ${short}`}
        >
          {chipContent}
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner align={menuAlign === "left" ? "start" : "end"} sideOffset={4}>
            <AccountMenuPopup
              accounts={menuAccounts}
              currentAddress={currentAddress}
              walletName={walletName}
              network={network}
              authLabel={authLabel}
              manageHref={manageHref}
              manageAccountsHref={manageAccountsHref}
              explorerHref={explorerHref}
              onSwitch={handleSwitch}
              onAddAccount={onAddAccount}
              onDisconnect={onDisconnect}
              disconnectLabel={disconnectLabel}
              onNavigate={() => setOpen(false)}
            >
              {children}
            </AccountMenuPopup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    );
  },
);
