import * as React from "react";
import { cn } from "../../../utils";
import { styledDiv } from "../../../lib/styled";
import { Menu } from "../../Menu/Menu";
import { Disc } from "../Disc/Disc";
import { useCopy } from "../CopyButton/CopyButton";
import "./AccountMenu.css";

const CopyIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="0.5" stroke="currentColor" strokeWidth="1.3" />
    <path d="M10.5 5.5V3a.5.5 0 0 0-.5-.5H3a.5.5 0 0 0-.5.5v7a.5.5 0 0 0 .5.5h2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);
const LinkIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <path d="M10 14a4 4 0 0 0 6 .5l3-3a4 4 0 1 0-6-6l-1.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
    <path d="M14 10a4 4 0 0 0-6-.5l-3 3a4 4 0 1 0 6 6L12.5 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
  </svg>
);
const XIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
  </svg>
);
const PlusIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
  </svg>
);
const GearIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
    <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
  </svg>
);
const PlusCircle = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 5v6M5 8h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
  </svg>
);
const CodeIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}>
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </svg>
);
const ArrowUpRight = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <path d="M7 17 17 7M9 7h8v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" />
  </svg>
);

export interface ConnectAccount {
  /** Display name ("Main", "Trading"); falls back to the short address. */
  name?: React.ReactNode;
  address: string;
  /** Formatted balance. */
  balance?: React.ReactNode;
  /** Avatar fill color; ignored when `avatar` is given. */
  color?: string;
  /** Custom avatar node (an image disc, a Jazzicon, …). */
  avatar?: React.ReactNode;
}

export const DEFAULT_MANAGE_HREF = "https://wallet.tid.sh";
export const DEFAULT_MANAGE_ACCOUNTS_HREF = "https://app.tid.sh/accounts";
const COPIED_MS = 1200;

/** Middle-truncate an address the way the connected chip does (6 … 4). */
export function shortenWalletAddress(address: string, leading = 6, trailing = 4): string {
  if (address.length <= leading + trailing + 2) return address;
  return `${address.slice(0, leading)}…${address.slice(-trailing)}`;
}

export function AccountAvatar({ account, size }: { account: ConnectAccount; size: number }) {
  if (account.avatar) return <>{account.avatar}</>;
  return <Disc size={size} color={account.color ?? "var(--sky-400)"} />;
}

export interface AccountMenuPopupProps {
  /** Every account; the one matching `currentAddress` heads the menu. */
  accounts: ConnectAccount[];
  currentAddress: string;
  /** Wallet name in the manage button (default "Thru Wallet"). */
  walletName?: React.ReactNode;
  /** "menu" (default) inside a Base UI `Menu`; "sheet" as plain rows in a bottom sheet. */
  presentation?: "menu" | "sheet";
  /** "Manage your Thru Wallet" target; `null` hides it. */
  manageHref?: string | null;
  /** "Manage accounts" target; `null` hides it (unless `onManageAccounts` is set). */
  manageAccountsHref?: string | null;
  /** "Manage accounts" as an action instead of a link (takes precedence over the href). */
  onManageAccounts?: () => void;
  /** Explorer link for the current account; omit to hide the item. */
  explorerHref?: string;
  /** A "Switch account" pick. */
  onSwitch?: (account: ConnectAccount, index: number) => void;
  /** "Add account"; omit to hide the item. */
  onAddAccount?: () => void;
  /** "Add funds" — opens the wallet's deposit sheet; omit to hide the item. */
  onAddFunds?: () => void;
  /** Developer mode row (a checkbox item); omit `onDeveloperModeChange` to hide it. */
  developerMode?: boolean;
  onDeveloperModeChange?: (enabled: boolean) => void;
  developerModeLabel?: React.ReactNode;
  /** One line under the label, e.g. "Card purchases use Coinbase's sandbox". */
  developerModeHint?: React.ReactNode;
  addFundsLabel?: React.ReactNode;
  /** "Sign out". */
  onDisconnect?: () => void;
  disconnectLabel?: React.ReactNode;
  /** Called when a link item is followed (so a host can close the menu). */
  onNavigate?: () => void;
  /** Extra `Menu.Item`s inserted before the sign-out separator. */
  children?: React.ReactNode;
  /** Draw for a light or dark page regardless of the document's theme. */
  theme?: "light" | "dark";
  className?: string;
}

type SheetItemProps = Pick<React.ComponentPropsWithoutRef<"button">, "children" | "className" | "disabled"> & {
  render?: React.ReactElement<React.HTMLAttributes<HTMLElement>>;
  onClick?: React.MouseEventHandler<HTMLElement>;
};

function SheetItem({ render, className, ...props }: SheetItemProps) {
  const itemProps = {
    ...props,
    className: cn("tds-menu-item", className),
    "data-disabled": props.disabled ? "" : undefined,
  };
  return render ? React.cloneElement(render, itemProps) : <button type="button" {...itemProps} />;
}

const SheetParts = {
  Popup: "div",
  Item: SheetItem,
  CheckboxItem: ({ checked, onCheckedChange, closeOnClick: _closeOnClick, ...props }: SheetItemProps & {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    closeOnClick?: boolean;
  }) => (
    <button
      type="button"
      {...props}
      className={cn("tds-menu-item", props.className)}
      role="switch"
      aria-checked={checked}
      data-checked={checked ? "" : undefined}
      onClick={() => onCheckedChange(!checked)}
    />
  ),
  Separator: styledDiv("tds-menu-sep"),
  Group: ({ children }: { children: React.ReactNode }) => <div role="group">{children}</div>,
  GroupLabel: styledDiv("tds-menu-label"),
} satisfies Record<string, React.ElementType>;

/**
 * AccountMenuPopup — the wallet's account menu.
 *
 * Menu presentation mounts inside Base UI `Menu.Root` / `Menu.Portal` /
 * `Menu.Positioner`. Sheet presentation renders plain elements without a menu context.
 */
export const AccountMenuPopup = React.forwardRef<HTMLDivElement, AccountMenuPopupProps>(
  function AccountMenuPopup(
    {
      accounts,
      currentAddress,
      walletName = "Thru Wallet",
      presentation = "menu",
      manageHref = DEFAULT_MANAGE_HREF,
      manageAccountsHref = DEFAULT_MANAGE_ACCOUNTS_HREF,
      explorerHref,
      onSwitch,
      onAddAccount,
      onManageAccounts,
      onAddFunds,
      developerMode = false,
      onDeveloperModeChange,
      developerModeLabel = "Developer mode",
      developerModeHint,
      addFundsLabel = "Add funds",
      onDisconnect,
      disconnectLabel = "Sign out",
      onNavigate,
      children,
      theme,
      className,
    },
    ref,
  ) {
    const P = presentation === "sheet" ? SheetParts : Menu;
    const { copy, notifying } = useCopy(COPIED_MS);
    const list = accounts.length > 0 ? accounts : [{ address: currentAddress }];
    const currentIdx = Math.max(
      0,
      list.findIndex((a) => a.address === currentAddress),
    );
    const current = list[currentIdx];
    const short = shortenWalletAddress(current.address);
    const others = list.filter((_, i) => i !== currentIdx);

    return (
      <P.Popup
        ref={ref}
        className={cn("tds-connect-menu", presentation === "sheet" && "tds-connect-menu--sheet", className)}
        data-theme={theme}
      >
        <div className="tds-connect-menu__head">
          <div className="tds-connect-menu__who">
            <div className="tds-connect-menu__name">{current.name ?? short}</div>
            <div className="tds-connect-menu__addr">
              <span title={current.address}>{notifying ? "Address copied" : short}</span>
              <button
                type="button"
                className="tds-connect-menu__copy"
                aria-label="Copy address"
                onClick={() => copy(current.address)}
              >
                <CopyIcon width={14} height={14} />
              </button>
            </div>
          </div>
          {current.balance != null && <span className="tds-connect-menu__bal">{current.balance}</span>}
        </div>
        {manageHref && (
          <div className="tds-connect-menu__manage">
            <a
              href={manageHref}
              target="_blank"
              rel="noreferrer"
              className="tds-connect-menu__manage-link"
              onClick={onNavigate}
            >
              Manage your {walletName}
              <ArrowUpRight width={12} height={12} />
            </a>
          </div>
        )}
        {onAddFunds && (
          <>
            <P.Separator className="tds-connect-menu__sep" />
            <P.Item onClick={() => onAddFunds()}>
              <span className="tds-connect-menu__icon">
                <PlusCircle width={14} height={14} />
              </span>
              {addFundsLabel}
            </P.Item>
          </>
        )}
        {(others.length > 0 || onAddAccount || onManageAccounts || manageAccountsHref) && (
          <>
            <P.Separator className="tds-connect-menu__sep" />
            {others.length > 0 && (
              <P.Group>
                <P.GroupLabel className="tds-connect-menu__group">Switch account</P.GroupLabel>
                {others.map((account) => (
                  <P.Item
                    key={account.address}
                    className="tds-connect-menu__account"
                    onClick={() => onSwitch?.(account, list.indexOf(account))}
                  >
                    <span className="tds-connect-menu__account-avatar">
                      <AccountAvatar account={account} size={22} />
                    </span>
                    <span className="tds-connect-menu__account-main">
                      <span className="tds-connect-menu__account-name">
                        {account.name ?? shortenWalletAddress(account.address)}
                      </span>
                      <span className="tds-connect-menu__account-addr">
                        {shortenWalletAddress(account.address)}
                      </span>
                    </span>
                    {account.balance != null && (
                      <span className="tds-connect-menu__account-bal">{account.balance}</span>
                    )}
                  </P.Item>
                ))}
              </P.Group>
            )}
            {onAddAccount && (
              <P.Item onClick={() => onAddAccount()}>
                <span className="tds-connect-menu__icon">
                  <PlusIcon width={14} height={14} />
                </span>
                Add account
              </P.Item>
            )}
            {onManageAccounts ? (
              <P.Item onClick={() => onManageAccounts()}>
                <span className="tds-connect-menu__icon">
                  <GearIcon width={14} height={14} />
                </span>
                <span className="tds-connect-menu__grow">Manage accounts</span>
                <ArrowUpRight width={12} height={12} className="tds-connect-menu__ext" />
              </P.Item>
            ) : manageAccountsHref && (
              <P.Item
                render={<a href={manageAccountsHref} target="_blank" rel="noreferrer" />}
                onClick={onNavigate}
              >
                <span className="tds-connect-menu__icon">
                  <GearIcon width={14} height={14} />
                </span>
                <span className="tds-connect-menu__grow">Manage accounts</span>
                <ArrowUpRight width={12} height={12} className="tds-connect-menu__ext" />
              </P.Item>
            )}
          </>
        )}
        {children}
        <P.Separator />
        {explorerHref && (
          <P.Item
            render={<a href={explorerHref} target="_blank" rel="noreferrer" />}
            onClick={onNavigate}
          >
            <span className="tds-connect-menu__icon">
              <LinkIcon width={14} height={14} />
            </span>
            View on explorer
          </P.Item>
        )}
        {onDeveloperModeChange && (
          <P.CheckboxItem
            className="tds-connect-menu__toggle"
            checked={developerMode}
            onCheckedChange={(checked) => onDeveloperModeChange(Boolean(checked))}
            closeOnClick={false}
          >
            <span className="tds-connect-menu__icon">
              <CodeIcon width={14} height={14} />
            </span>
            <span className="tds-connect-menu__toggle-text">
              <span>{developerModeLabel}</span>
              {developerModeHint && <span className="tds-connect-menu__toggle-hint">{developerModeHint}</span>}
            </span>
            <span className="tds-connect-menu__switch" aria-hidden="true">
              <span className="tds-connect-menu__switch-thumb" />
            </span>
          </P.CheckboxItem>
        )}
        <P.Item className="tds-connect-menu__danger" onClick={() => onDisconnect?.()}>
          <span className="tds-connect-menu__icon">
            <XIcon width={14} height={14} />
          </span>
          {disconnectLabel}
        </P.Item>
        <div className="tds-connect-menu__pad" />
      </P.Popup>
    );
  },
);
