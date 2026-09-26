import * as React from "react";
import { cn } from "../../../utils";
import { Address } from "../../Address/Address";
import { ThruDisc, ThruWordmark } from "../Brand/Brand";
import type { PairDeviceKind } from "../WalletSheet/PairScreens";
import "./PairApprove.css";

/* ── Icons ─────────────────────────────────────────────────────────── */
const Lock = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <rect x="3" y="7" width="10" height="7" stroke="currentColor" strokeWidth="1.3" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);
const Phone = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" {...p}>
    <rect x="6" y="2.5" width="12" height="19" rx="1.5" />
    <path d="M11 18h2" />
  </svg>
);
const Laptop = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" {...p}>
    <rect x="3" y="5" width="18" height="12" rx="1" />
    <path d="M8 20h8" />
  </svg>
);
const Shield = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" {...p}>
    <path d="M12 3l7 2.6v5.6c0 4.4-2.8 7.3-7 8.8-4.2-1.5-7-4.4-7-8.8V5.6L12 3Z" />
  </svg>
);
const Clock = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 3" />
  </svg>
);
const Check = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <path d="M3 8.5l3.5 3.5L13 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const BigCheck = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden stroke="currentColor" strokeWidth="2" strokeLinecap="square" {...p}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const DeviceGlyph = ({ kind, size }: { kind?: PairDeviceKind; size: number }) =>
  kind === "laptop" ? <Laptop width={size} height={size} /> : <Phone width={size} height={size} />;

/* ── Types ─────────────────────────────────────────────────────────── */
export type PairApproveState = "review" | "approving" | "done" | "expired" | "notSignedIn";

export interface PairApproveAccount {
  address: string;
  /** "Main · passkey on this device". */
  label?: React.ReactNode;
  balance?: React.ReactNode;
  /** Account disc color (defaults to ocean). */
  color?: string;
}

/** Progress through the approval: 0 passkey, 1 adding the device. */
export type PairApproveStep = 0 | 1;

export interface PairApproveProps {
  state: PairApproveState;
  /** The new device ("Jerry’s iPhone"). */
  deviceName?: React.ReactNode;
  /** "iPhone · Safari 26 · via meridian.xyz". */
  deviceMeta?: React.ReactNode;
  deviceKind?: PairDeviceKind;
  /** "20 seconds ago". */
  requested?: React.ReactNode;
  /** Accounts this device can add the new one to; two or more become a radio list. */
  accounts?: PairApproveAccount[];
  selectedAccount?: number;
  onSelectAccount?: (index: number) => void;
  /** This device's name, for the footer and the done list. */
  thisDeviceName?: React.ReactNode;
  thisDeviceKind?: PairDeviceKind;
  /** Signed-in account shown in the footer; omit to hide the footer. */
  signedInAddress?: string;
  /** "Approve with Face ID" on iOS, "Approve with passkey" elsewhere. */
  approveLabel?: React.ReactNode;
  /** Plain-words failure shown over the review actions. */
  error?: React.ReactNode;
  /** Active step while approving. */
  step?: PairApproveStep;
  busy?: boolean;
  onApprove?: () => void;
  onCancel?: () => void;
  onDone?: () => void;
  onScanAgain?: () => void;
  onSignIn?: () => void;
  /** Page path in the header lock tag. */
  path?: string;
  className?: string;
}

function Hero({
  icon,
  tone = "muted",
  title,
  children,
}: {
  icon: React.ReactNode;
  tone?: "muted" | "forest";
  title: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="tds-mpair__hero">
      <span className={cn("tds-mpair__hero-disc", tone === "forest" && "tds-mpair__hero-disc--ok")}>{icon}</span>
      <h1 className="tds-mpair__title">{title}</h1>
      {children != null && <p className="tds-mpair__sub">{children}</p>}
    </div>
  );
}

function AccountBody({ account }: { account: PairApproveAccount }) {
  return (
    <>
      <span className="tds-mpair__acct-disc" style={{ background: account.color ?? "var(--m-ocean)" }} />
      <span className="tds-mpair__acct-main">
        <Address value={account.address} leading={6} trailing={4} copy={false} className="tds-mpair__mono15" />
        {account.label != null && <span className="tds-mpair__meta">{account.label}</span>}
      </span>
      {account.balance != null && <span className="tds-mpair__mono15 tds-mpair__acct-bal">{account.balance}</span>}
    </>
  );
}

function Review({
  deviceName,
  deviceMeta,
  deviceKind,
  requested,
  accounts = [],
  selectedAccount = 0,
  onSelectAccount,
  approveLabel,
  error,
  busy,
  onApprove,
  onCancel,
}: PairApproveProps) {
  const multi = accounts.length > 1;
  const onRadioKey = (event: React.KeyboardEvent, index: number) => {
    const next =
      event.key === "ArrowDown" || event.key === "ArrowRight"
        ? (index + 1) % accounts.length
        : event.key === "ArrowUp" || event.key === "ArrowLeft"
          ? (index - 1 + accounts.length) % accounts.length
          : -1;
    if (next < 0) return;
    event.preventDefault();
    onSelectAccount?.(next);
    (event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
  };
  return (
    <div className="tds-mpair__stack">
      <div className="tds-mpair__heading">
        <h1 className="tds-mpair__title">Add this device to your account?</h1>
        <p className="tds-mpair__sub">It gets the same access as this one.</p>
      </div>
      <div className="tds-mpair__card">
        <div className="tds-mpair__request">
          <span className="tds-mpair__glyph">
            <DeviceGlyph kind={deviceKind} size={22} />
          </span>
          <span className="tds-mpair__request-main">
            <span className="tds-mpair__device">{deviceName ?? "New device"}</span>
            {deviceMeta != null && <span className="tds-mpair__meta">{deviceMeta}</span>}
          </span>
        </div>
        {requested != null && (
          <>
            <div className="tds-mpair__hair" />
            <div className="tds-mpair__kv">
              <span className="tds-mpair__eyebrow tds-mpair__kv-label">Requested</span>
              <span className="tds-mpair__kv-value">{requested}</span>
            </div>
          </>
        )}
      </div>
      {accounts.length > 0 && (
        <div className="tds-mpair__field">
          <span className="tds-mpair__eyebrow" id="tds-mpair-add-to">
            Add to
          </span>
          {multi ? (
            <div role="radiogroup" aria-labelledby="tds-mpair-add-to" className="tds-mpair__radios">
              {accounts.map((account, index) => {
                const on = index === selectedAccount;
                return (
                  <div
                    key={account.address}
                    role="radio"
                    aria-checked={on}
                    tabIndex={on ? 0 : -1}
                    className="tds-mpair__acct tds-mpair__acct--radio"
                    onClick={() => onSelectAccount?.(index)}
                    onKeyDown={(event) => {
                      if (event.key === " " || event.key === "Enter") {
                        event.preventDefault();
                        onSelectAccount?.(index);
                      } else onRadioKey(event, index);
                    }}
                  >
                    <AccountBody account={{ ...account, balance: undefined }} />
                    <span className={cn("tds-mpair__radio", on && "tds-mpair__radio--on")} aria-hidden />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="tds-mpair__acct tds-mpair__acct--single">
              <AccountBody account={accounts[0]!} />
            </div>
          )}
        </div>
      )}
      {error != null && (
        <div className="tds-mpair__error" role="alert">
          {error}
        </div>
      )}
      <div className="tds-mpair__actions">
        <button type="button" className="tds-mpair__btn tds-mpair__btn--primary" disabled={busy} onClick={onApprove}>
          {approveLabel ?? "Approve with passkey"}
        </button>
        <button type="button" className="tds-mpair__btn tds-mpair__btn--outline" disabled={busy} onClick={onCancel}>
          Not me — cancel
        </button>
      </div>
      <p className="tds-mpair__note">
        <Shield width={16} height={16} className="tds-mpair__note-icon" />
        <span>Only approve a device you have in front of you.</span>
      </p>
    </div>
  );
}

function StepRow({ status, children }: { status: "done" | "active" | "pending"; children: React.ReactNode }) {
  return (
    <li className={cn("tds-mpair__step", status === "pending" && "tds-mpair__step--pending")}>
      <span className="tds-mpair__step-mark" aria-hidden>
        {status === "done" ? (
          <Check width={15} height={15} className="tds-mpair__step-done" />
        ) : status === "active" ? (
          <span className="tds-mpair__spin tds-mpair__spin--sm" />
        ) : (
          <span className="tds-mpair__step-dot" />
        )}
      </span>
      {children}
    </li>
  );
}

/**
 * PairApprove — the approver page at app.tid.sh/pair, on the wallet-app (mobile)
 * tokens from `@thru/design/mobile/tokens.css`. Presentational: the page drives
 * `state` from the payload, the signed-in passkey and the add-device result.
 */
export function PairApprove(props: PairApproveProps) {
  const {
    state,
    deviceName = "New device",
    deviceKind,
    thisDeviceName,
    thisDeviceKind = "laptop",
    signedInAddress,
    step = 1,
    onDone,
    onScanAgain,
    onSignIn,
    busy,
    path = "app.tid.sh/pair",
    className,
  } = props;
  const stepStatus = (index: number) => (index < step ? "done" : index === step ? "active" : "pending");

  return (
    <div className={cn("tds-mpair", className)}>
      <header className="tds-mpair__bar">
        <span className="tds-mpair__lockup">
          <ThruDisc size={24} />
          <ThruWordmark height={16} title="thru" className="tds-mpair__wordmark" />
        </span>
        <span className="tds-mpair__tag">
          <Lock width={11} height={11} />
          {path}
        </span>
      </header>

      <main className="tds-mpair__body">
        <div className="tds-mpair__column">
          {state === "review" && <Review {...props} />}

          {state === "approving" && (
            <div className="tds-mpair__stack">
              <Hero
                icon={<span className="tds-mpair__spin" role="status" aria-label="Approving" />}
                title={<>Adding {deviceName}</>}
              >
                Keep this page open for a moment.
              </Hero>
              <ol className="tds-mpair__steps" aria-live="polite">
                <StepRow status={stepStatus(0)}>Passkey verified</StepRow>
                <StepRow status={stepStatus(1)}>Adding the device to your account</StepRow>
              </ol>
            </div>
          )}

          {state === "done" && (
            <div className="tds-mpair__stack">
              <Hero icon={<BigCheck width={26} height={26} />} tone="forest" title={<>{deviceName} added</>} />
              <div className="tds-mpair__card">
                <div className="tds-mpair__device-row tds-mpair__device-row--hair">
                  <DeviceGlyph kind={thisDeviceKind} size={20} />
                  <span className="tds-mpair__device-row-name">{thisDeviceName ?? "This device"}</span>
                  <span className="tds-mpair__chip">this device</span>
                </div>
                <div className="tds-mpair__device-row">
                  <DeviceGlyph kind={deviceKind} size={20} />
                  <span className="tds-mpair__device-row-name">{deviceName}</span>
                  <span className="tds-mpair__chip tds-mpair__chip--new">added just now</span>
                </div>
              </div>
              <button type="button" className="tds-mpair__btn tds-mpair__btn--primary" onClick={onDone}>
                Done
              </button>
            </div>
          )}

          {state === "expired" && (
            <div className="tds-mpair__stack">
              <Hero icon={<Clock width={22} height={22} />} title="This code has expired">
                Tap <strong className="tds-mpair__strong">New code</strong> on your new device and scan again.
              </Hero>
              <button type="button" className="tds-mpair__btn tds-mpair__btn--primary" onClick={onScanAgain}>
                Scan again
              </button>
            </div>
          )}

          {state === "notSignedIn" && (
            <div className="tds-mpair__stack">
              <Hero icon={<Shield width={22} height={22} />} title="Sign in first">
                Sign in on this device, then scan the code again.
              </Hero>
              <button type="button" className="tds-mpair__btn tds-mpair__btn--primary" disabled={busy} onClick={onSignIn}>
                Sign in with passkey
              </button>
            </div>
          )}
        </div>
      </main>

      {signedInAddress && (
        <footer className="tds-mpair__foot">
          Signed in as <Address value={signedInAddress} leading={6} trailing={4} copy={false} className="tds-mpair__foot-addr" />
          {thisDeviceName != null && <> on {thisDeviceName}</>}
        </footer>
      )}
    </div>
  );
}
