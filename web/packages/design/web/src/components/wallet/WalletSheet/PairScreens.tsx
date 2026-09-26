import * as React from "react";
import QRCode from "qrcode";
import { cn } from "../../../utils";
import { Button } from "../../Button/Button";
import { Address } from "../../Address/Address";
import { Disc } from "../Disc/Disc";
import { ThruDisc, PoweredBy } from "../Brand/Brand";
import { copyText } from "../CopyButton/CopyButton";
import { Screen } from "../Screen/Screen";
import "./PairScreens.css";

/* ── Icons ─────────────────────────────────────────────────────────── */
const TwoDevices = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" {...p}>
    <rect x="3" y="5" width="12" height="15" rx="1" />
    <path d="M15 9h5a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-5M9 17h.01" />
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
    <rect x="4" y="5" width="16" height="11" rx="1" />
    <path d="M2 19h20" />
  </svg>
);
const Pencil = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" {...p}>
    <path d="M4 20h4L19 9l-4-4L4 16v4Z" />
    <path d="m13 7 4 4" />
  </svg>
);
const Check = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <path d="M3 8.5l3.5 3.5L13 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Refresh = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" {...p}>
    <path d="M20 12a8 8 0 1 1-2.34-5.66" />
    <path d="M20 4v5h-5" strokeLinejoin="round" />
  </svg>
);
const Share = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" {...p}>
    <path d="M12 3v13M7 8l5-5 5 5" />
    <path d="M5 12v8h14v-8" />
  </svg>
);
const Warning = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" {...p}>
    <path d="M12 3 2 21h20L12 3Z" />
    <path d="M12 10v5M12 17.5v.5" />
  </svg>
);
const AlertCircle = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v6M12 16v.5" />
  </svg>
);
const ChevronDown = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
  </svg>
);
const CopyIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="0.5" stroke="currentColor" strokeWidth="1.3" />
    <path d="M10.5 5.5V3a.5.5 0 0 0-.5-.5H3a.5.5 0 0 0-.5.5v7a.5.5 0 0 0 .5.5h2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

/* ── Types ─────────────────────────────────────────────────────────── */
export type PairDeviceKind = "phone" | "laptop";

/**
 * `sheet` is the phone bottom sheet (Send link first, since a phone can't scan
 * itself); `dialog` the 360px web dialog (QR first, Copy link only).
 */
export type PairLayout = "sheet" | "dialog";

/** Code-screen status. */
export type PairCodeStatus = "creating" | "ready" | "approved" | "expired" | "error";

const DeviceGlyph = ({ kind, size }: { kind: PairDeviceKind; size: number }) =>
  kind === "laptop" ? <Laptop width={size} height={size} /> : <Phone width={size} height={size} />;

/* ── QR ────────────────────────────────────────────────────────────── */
export interface PairQrProps {
  /** Approval URL. Omit while it is being created. */
  value?: string;
  /** Outer box size in px (default 180). */
  size?: number;
  /** Fade the modules (creating / expired / error). */
  dim?: boolean;
  /** Overlay drawn over the dimmed modules. */
  children?: React.ReactNode;
  className?: string;
}

/**
 * PairQr — the approval link as a real QR, drawn in the primary text color on
 * the higher surface with the Thru disc over the centre. Error correction Q
 * (25%): the disc covers ~4% of the code, and H would add a version's worth of
 * modules to an already long link.
 */
export function PairQr({ value, size = 180, dim = false, children, className }: PairQrProps) {
  const matrix = React.useMemo(() => {
    if (!value) return null;
    try {
      const qr = QRCode.create(value, { errorCorrectionLevel: "Q" });
      return { size: qr.modules.size, data: qr.modules.data };
    } catch {
      return null;
    }
  }, [value]);
  const inner = size - 22; /* 10px padding + 1px border each side */
  const showMark = !!matrix && !dim;
  return (
    <span className={cn("tds-pair__qr", className)} style={{ width: size, height: size }}>
      {matrix && (
        <svg
          viewBox={`0 0 ${matrix.size} ${matrix.size}`}
          width={inner}
          height={inner}
          shapeRendering="crispEdges"
          className={cn("tds-pair__qr-svg", dim && "tds-pair__qr-svg--dim")}
          aria-hidden
        >
          {Array.from(matrix.data).map((on, i) =>
            on ? <rect key={i} x={i % matrix.size} y={Math.floor(i / matrix.size)} width={1} height={1} /> : null,
          )}
        </svg>
      )}
      {showMark && (
        <span className="tds-pair__qr-mark" aria-hidden>
          <ThruDisc size={30} />
        </span>
      )}
      {children}
    </span>
  );
}

/* ── Intro — "Add this device" ─────────────────────────────────────── */
export interface WalletSheetPairIntroProps {
  /** Pre-filled from the user agent ("Jerry’s iPhone", "iPhone · Safari"). */
  deviceName: string;
  /** "iPhone · Safari 26 · new passkey". */
  deviceMeta?: React.ReactNode;
  deviceKind?: PairDeviceKind;
  /** Makes the name editable in place; omit to hide the pencil. */
  onDeviceNameChange?: (name: string) => void;
  onContinue?: () => void;
  onBack?: () => void;
  /** The WebAuthn hybrid / system-QR sign-in (one-time, adds nothing). */
  onUseOtherPasskey?: () => void;
  /** Disable Continue while the passkey ceremony starts. */
  busy?: boolean;
  poweredBy?: boolean;
}

function PairIntro({
  deviceName,
  deviceMeta,
  deviceKind = "phone",
  onDeviceNameChange,
  onContinue,
  onBack,
  onUseOtherPasskey,
  busy = false,
  poweredBy = true,
}: WalletSheetPairIntroProps) {
  const [editing, setEditing] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);
  const finish = () => {
    setEditing(false);
    if (!deviceName.trim()) onDeviceNameChange?.("");
  };

  return (
    <>
      <Screen className="tds-pair">
        <div className="tds-pair__hero">
          <span className="tds-pair__disc">
            <TwoDevices width={22} height={22} />
          </span>
          <div className="tds-pair__title">Add this device</div>
          <div className="tds-pair__sub">Approve it from a device that already has your account.</div>
        </div>
        <div className="tds-pair__field">
          <span className="tds-pair__label" id="tds-pair-device-label">
            This device
          </span>
          <div className="tds-pair__device">
            <span className="tds-pair__device-glyph">
              <DeviceGlyph kind={deviceKind} size={20} />
            </span>
            <span className="tds-pair__device-main">
              {editing ? (
                <input
                  ref={inputRef}
                  className="tds-pair__device-input"
                  value={deviceName}
                  maxLength={64}
                  aria-labelledby="tds-pair-device-label"
                  onChange={(e) => onDeviceNameChange?.(e.target.value)}
                  onBlur={finish}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === "Escape") {
                      e.preventDefault();
                      finish();
                    }
                  }}
                />
              ) : (
                <span className="tds-pair__device-name">{deviceName}</span>
              )}
              {deviceMeta != null && <span className="tds-pair__device-meta">{deviceMeta}</span>}
            </span>
            {onDeviceNameChange && !editing && (
              <button
                type="button"
                className="tds-pair__icon-btn"
                aria-label="Rename this device"
                onClick={() => setEditing(true)}
              >
                <Pencil width={16} height={16} />
              </button>
            )}
          </div>
        </div>
        <div className="tds-pair__actions">
          <Button variant="primary" size="lg" className="tds-wsheet__cta" disabled={busy} onClick={onContinue}>
            Continue
          </Button>
          {onBack && (
            <Button variant="outline" size="lg" className="tds-wsheet__cta" onClick={onBack}>
              Back
            </Button>
          )}
        </div>
        {onUseOtherPasskey && (
          <button type="button" className="tds-pair__text-btn" onClick={onUseOtherPasskey}>
            Use a passkey from your phone instead
          </button>
        )}
      </Screen>
      {poweredBy && <PoweredBy />}
    </>
  );
}

/* ── Code — "Approve on your other device" ─────────────────────────── */
export interface WalletSheetPairCodeProps {
  status: PairCodeStatus;
  /** Approval URL encoded in the QR and shared / copied. */
  approveUrl?: string;
  /** Epoch ms the code expires; drives the live countdown. */
  expiresAt?: number;
  layout?: PairLayout;
  /** Raw error text, shown only behind Details when `developerMode`. */
  errorMessage?: string;
  developerMode?: boolean;
  /** New code (expired) / Try again (error) / the refresh icon. */
  onRefresh?: () => void;
  /** Called when the countdown reaches zero, so the host can mark it expired. */
  onExpire?: () => void;
  /** Send link. Defaults to `navigator.share`, falling back to copy. */
  onShare?: (url: string) => void | Promise<void>;
  /** Copy link. Defaults to the clipboard helper. */
  onCopy?: (url: string) => void | Promise<void>;
  poweredBy?: boolean;
}

function formatRemaining(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function useNow(active: boolean) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

/** Share the approval URL with the system sheet, copying when there is none
 *  (or the user dismisses it with an error other than cancel). Resolves to
 *  what happened so a caller can confirm a copy. */
export async function sharePairLink(url: string): Promise<"shared" | "copied" | "cancelled"> {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  if (nav && typeof nav.share === "function") {
    try {
      await nav.share({ url, title: "Approve this device" });
      return "shared";
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return "cancelled";
    }
  }
  await copyText(url);
  return "copied";
}

const STATUS_TEXT: Record<PairCodeStatus, string> = {
  creating: "Creating a pairing code…",
  ready: "Waiting for your other device",
  approved: "Approved · signing in",
  expired: "Codes last 5 minutes.",
  error: "",
};

function PairCode({
  status,
  approveUrl,
  expiresAt,
  layout = "sheet",
  errorMessage,
  developerMode = false,
  onRefresh,
  onExpire,
  onShare,
  onCopy,
  poweredBy = true,
}: WalletSheetPairCodeProps) {
  const creating = status === "creating";
  const expired = status === "expired";
  const error = status === "error";
  const dim = creating || expired || error;
  const counting = !dim && status !== "approved" && expiresAt != null;
  const now = useNow(counting);
  const remaining = expiresAt != null ? expiresAt - now : undefined;

  const expireRef = React.useRef(onExpire);
  expireRef.current = onExpire;
  React.useEffect(() => {
    if (!counting || remaining == null || remaining > 0) return;
    expireRef.current?.();
  }, [counting, remaining]);

  const [copied, setCopied] = React.useState(false);
  const copiedTimer = React.useRef<number>(0);
  React.useEffect(() => () => window.clearTimeout(copiedTimer.current), []);
  const flashCopied = () => {
    setCopied(true);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1200);
  };

  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [errorCopied, setErrorCopied] = React.useState(false);

  const linkDisabled = dim || !approveUrl;
  const handleCopy = async () => {
    if (!approveUrl) return;
    await (onCopy ? onCopy(approveUrl) : copyText(approveUrl));
    flashCopied();
  };
  const handleShare = async () => {
    if (!approveUrl) return;
    if (onShare) return onShare(approveUrl);
    if ((await sharePairLink(approveUrl)) === "copied") flashCopied();
  };

  const statusText = STATUS_TEXT[status];
  const expiryText = counting && remaining != null ? `Expires in ${formatRemaining(remaining)}` : expired ? "Code expired" : "";

  return (
    <>
      <Screen className="tds-pair">
        <div className="tds-pair__heading">
          <div className="tds-pair__title">Approve on your other device</div>
          <div className="tds-pair__sub tds-pair__sub--sm">Scan with a device that has your account</div>
        </div>
        <div className="tds-pair__code">
          <PairQr value={approveUrl} dim={dim}>
            {creating && (
              <span className="tds-pair__qr-over" role="status" aria-label="Creating code">
                <span className="tds-pair__spin" />
              </span>
            )}
            {expired && (
              <span className="tds-pair__qr-over tds-pair__qr-over--veil">
                <span className="tds-pair__qr-note">Code expired</span>
                {onRefresh && (
                  <button type="button" className="tds-pair__small-btn" onClick={onRefresh}>
                    New code
                  </button>
                )}
              </span>
            )}
            {error && (
              <span className="tds-pair__qr-over tds-pair__qr-over--veil tds-pair__qr-over--error">
                <Warning width={28} height={28} />
              </span>
            )}
          </PairQr>
          <div className="tds-pair__expiry">
            <span>{expiryText}</span>
            {counting && onRefresh && (
              <button type="button" className="tds-pair__refresh" aria-label="New code" onClick={onRefresh}>
                <Refresh width={15} height={15} />
              </button>
            )}
          </div>
        </div>
        {error && (
          <div className="tds-pair__callout" role="alert">
            <div className="tds-pair__callout-row">
              <AlertCircle width={16} height={16} className="tds-pair__callout-icon" />
              <span className="tds-pair__callout-text">Couldn’t create a pairing code.</span>
              {onRefresh && (
                <button type="button" className="tds-pair__callout-btn" onClick={onRefresh}>
                  Try again
                </button>
              )}
            </div>
            {developerMode && errorMessage && (
              <>
                <button
                  type="button"
                  className="tds-pair__details"
                  aria-expanded={detailsOpen}
                  onClick={() => setDetailsOpen((open) => !open)}
                >
                  Details
                  <ChevronDown width={14} height={14} className="tds-pair__details-chev" />
                </button>
                {detailsOpen && (
                  <div className="tds-pair__details-body">
                    <div className="tds-pair__details-msg">{errorMessage}</div>
                    <button
                      type="button"
                      className="tds-pair__details-copy"
                      onClick={async () => {
                        await copyText(errorMessage);
                        setErrorCopied(true);
                        window.setTimeout(() => setErrorCopied(false), 1200);
                      }}
                    >
                      {errorCopied ? "Copied" : "Copy error"}
                      <CopyIcon width={14} height={14} />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
        <div className="tds-pair__actions">
          {layout === "sheet" && (
            <Button
              variant="primary"
              size="lg"
              className="tds-wsheet__cta tds-pair__link-btn"
              disabled={linkDisabled}
              onClick={handleShare}
            >
              <Share width={18} height={18} />
              Send link
            </Button>
          )}
          <Button
            variant="outline"
            size="lg"
            className="tds-wsheet__cta tds-pair__link-btn"
            disabled={linkDisabled}
            onClick={handleCopy}
          >
            {copied ? "Link copied" : "Copy link"}
          </Button>
        </div>
        <div
          className={cn("tds-pair__status", status === "approved" && "tds-pair__status--ok")}
          aria-live="polite"
        >
          {status === "ready" && <span className="tds-pair__spin tds-pair__spin--sm" />}
          {status === "approved" && <Check width={14} height={14} />}
          <span>{statusText}</span>
        </div>
      </Screen>
      {poweredBy && <PoweredBy />}
    </>
  );
}

/* ── Done — "{device} added" ───────────────────────────────────────── */
export interface WalletSheetPairDoneProps {
  deviceName: React.ReactNode;
  address: string;
  /** "Main · 2 devices". */
  accountLabel?: React.ReactNode;
  balance?: React.ReactNode;
  avatar?: React.ReactNode;
  onDone?: () => void;
  doneLabel?: React.ReactNode;
  poweredBy?: boolean;
}

function PairDone({
  deviceName,
  address,
  accountLabel,
  balance,
  avatar,
  onDone,
  doneLabel = "Done",
  poweredBy = true,
}: WalletSheetPairDoneProps) {
  return (
    <>
      <Screen className="tds-pair">
        <div className="tds-pair__hero">
          <span className="tds-pair__disc tds-pair__disc--ok">
            <Check width={22} height={22} />
          </span>
          <div className="tds-pair__title">{deviceName} added</div>
          <div className="tds-pair__sub">
            It can now sign in to your account.
          </div>
        </div>
        <div className="tds-pair__account">
          {avatar ?? <Disc size={24} color="var(--sky-400)" />}
          <div className="tds-pair__account-main">
            <Address value={address} leading={6} trailing={4} copy={false} className="tds-pair__account-addr" />
            {accountLabel != null && <span className="tds-pair__account-sub">{accountLabel}</span>}
          </div>
          {balance != null && <span className="tds-pair__account-bal">{balance}</span>}
        </div>
        <Button variant="primary" size="lg" className="tds-wsheet__cta" onClick={onDone}>
          {doneLabel}
        </Button>
      </Screen>
      {poweredBy && <PoweredBy />}
    </>
  );
}

/** The pair-a-new-device screens, spread into `WalletSheet`. */
export const PairScreens = {
  PairIntro,
  PairCode,
  PairDone,
};
