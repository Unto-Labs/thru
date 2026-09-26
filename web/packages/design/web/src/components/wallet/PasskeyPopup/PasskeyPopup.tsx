import * as React from "react";
import { cn } from "../../../utils";
import { Button } from "../../Button/Button";
import { Spinner } from "../../Spinner/Spinner";
import { Address } from "../../Address/Address";
import { Screen } from "../Screen/Screen";
import { Steps } from "../Steps/Steps";
import { Checklist } from "../Checklist/Checklist";
import { Disc } from "../Disc/Disc";
import { ErrorBox } from "../ErrorBox/ErrorBox";
import { ThruDisc, ThruWordmark } from "../Brand/Brand";
import { useWaitStages, WaitHero, WALLET_SHEET_SLOW_MS } from "../WalletSheet/wait";
import "./PasskeyPopup.css";

/* ── Icons ─────────────────────────────────────────────────────────── */
const Check = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <path d="M3 8.5l3.5 3.5L13 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const X = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);
const Lock = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <rect x="3" y="7" width="10" height="7" stroke="currentColor" strokeWidth="1.3" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);

/* ── Types ─────────────────────────────────────────────────────────── */
export type PasskeyPopupState = "waiting" | "ready" | "signing" | "done" | "error";

/** What the ceremony is for: sign in (an assertion), sign up (a
 *  registration), or confirm (an assertion the wallet asked for itself). */
export type PasskeyPopupFlow = "signin" | "signup" | "confirm";

export interface PasskeyPopupSite {
  /** Display name, e.g. "Meridian". */
  name: string;
  /** Host shown under the name, e.g. "meridian.xyz". */
  host: string;
  /** Optional provenance label for a host declared by a native app. */
  hostLabel?: string;
  /** Identity mark; defaults to an inverse disc with the name's initial. */
  icon?: React.ReactNode;
  /** Show the verified mark beside the host, never beside app-supplied branding. */
  verified?: boolean;
  /** Optional network chip, e.g. "mainnet". */
  tag?: string;
  /** Explanation of the status chip. */
  tagTitle?: string;
}

export interface PasskeyPopupAccount {
  address: string;
  /** Second line under the address (default "Passkey"). */
  label?: React.ReactNode;
  /** Right-aligned balance; omit when unknown. */
  balance?: React.ReactNode;
  /** Account mark; defaults to a sky disc. */
  icon?: React.ReactNode;
}

export interface PasskeyPopupProps {
  state: PasskeyPopupState;
  flow?: PasskeyPopupFlow;
  /** Host shown in the header lock tag (the popup's own host). */
  env?: string;
  /** Who is asking. Rendered as a skeleton while `waiting`. */
  site?: PasskeyPopupSite | null;
  /** The account the ceremony resolved to, shown on `done`. */
  account?: PasskeyPopupAccount | null;
  /** `error` title; defaults to the flow's ("Couldn’t sign in"). */
  errorTitle?: string;
  /** `error` subtitle; defaults to "The passkey request was cancelled or timed out." */
  errorDescription?: React.ReactNode;
  /** Raw error text for the copyable box; omit to hide the box. */
  errorMessage?: string;
  /** Start the ceremony (ready). Omit to disable the primary action. */
  onContinue?: () => void;
  /** Give up (waiting, ready, signing, error). */
  onCancel?: () => void;
  /** Run the ceremony again (error). Omit to hide "Try again". */
  onRetry?: () => void;
  /** Close the window (done). */
  onClose?: () => void;
  /** Footer caption. */
  footer?: React.ReactNode;
  /** Move focus to the primary action once the request is ready. Default true. */
  autoFocus?: boolean;
  /** Spinner → dove hand-off while signing. */
  slowAfterMs?: number;
  className?: string;
}

/* ── Copy ──────────────────────────────────────────────────────────── */
interface FlowCopy {
  title: string;
  description: (app: React.ReactNode) => React.ReactNode;
  checklist: (app: React.ReactNode) => [React.ReactNode, React.ReactNode];
  continueLabel: string;
  signingTitle: string;
  activeStep: string;
  doneTitle: string;
  errorTitle: string;
}

const CONFIRM_WITH = "Confirm with Touch ID, Face ID or a security key";

const COPY: Record<PasskeyPopupFlow, FlowCopy> = {
  signin: {
    title: "Sign in with Thru",
    description: (app) => <>{app} wants to sign you in with your Thru Wallet passkey.</>,
    checklist: (app) => [CONFIRM_WITH, <>{app} receives your address, never your passkey</>],
    continueLabel: "Continue with passkey",
    signingTitle: "Waiting for your passkey",
    activeStep: "Verifying passkey",
    doneTitle: "Signed in",
    errorTitle: "Couldn’t sign in",
  },
  signup: {
    title: "Create account with Thru",
    description: () => <>Create the passkey that signs in to your Thru Wallet.</>,
    checklist: () => [CONFIRM_WITH, "Your passkey stays on your device"],
    continueLabel: "Create your passkey",
    signingTitle: "Creating your passkey",
    activeStep: "Creating passkey",
    doneTitle: "Passkey created",
    errorTitle: "Couldn’t create your passkey",
  },
  confirm: {
    title: "Confirm with your passkey",
    description: () => <>Approve this request with your Thru Wallet passkey.</>,
    checklist: () => [CONFIRM_WITH, "Your passkey never leaves your device"],
    continueLabel: "Continue with passkey",
    signingTitle: "Waiting for your passkey",
    activeStep: "Verifying passkey",
    doneTitle: "Confirmed",
    errorTitle: "Couldn’t confirm",
  },
};

const DEFAULT_ERROR_DESCRIPTION = "The passkey request was cancelled or timed out.";
const DEFAULT_FOOTER = "This window opened so your browser can verify the passkey on tid.sh";

/* ── Parts ─────────────────────────────────────────────────────────── */
function Bar({ env }: { env?: string }) {
  return (
    <div className="tds-ppopup__bar">
      <span className="tds-ppopup__lockup">
        <ThruDisc size={24} />
        <ThruWordmark height={16} title="Thru" />
      </span>
      {env && (
        <span className="tds-ppopup__chip tds-ppopup__env" title={env}>
          <Lock width={11} height={11} />
          <span className="tds-ppopup__ellipsis">{env}</span>
        </span>
      )}
    </div>
  );
}

function SiteCell({ site }: { site?: PasskeyPopupSite | null }) {
  if (!site) {
    return (
      <div className="tds-ppopup__cell" aria-hidden>
        <span className="tds-ppopup__skel tds-ppopup__skel--disc" />
        <span className="tds-ppopup__cell-main tds-ppopup__cell-main--skel">
          <span className="tds-ppopup__skel tds-ppopup__skel--name" />
          <span className="tds-ppopup__skel tds-ppopup__skel--host" />
        </span>
      </div>
    );
  }
  const glyph = site.name.charAt(0).toUpperCase() || "?";
  return (
    <div className="tds-ppopup__cell">
      {site.icon ?? <Disc size={28} color="var(--color-surface-lower-inverse)" glyph={glyph} />}
      <span className="tds-ppopup__cell-main">
        <span className="tds-ppopup__cell-name">
          <span className="tds-ppopup__ellipsis" dir="auto">
            {site.name}
          </span>
        </span>
        <span className="tds-ppopup__cell-sub tds-ppopup__cell-host" dir="ltr">
          <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
            {site.hostLabel && <span>{site.hostLabel}: </span>}
            {site.host}
          </span>
          {site.verified && (
            <span className="tds-ppopup__verified" title="Verified site">
              <Check width={9} height={9} />
              <span className="tds-ppopup__sr">Verified</span>
            </span>
          )}
        </span>
      </span>
      {site.tag && (
        <span className="tds-ppopup__chip" title={site.tagTitle} aria-label={site.tagTitle}>
          {site.tag}
        </span>
      )}
    </div>
  );
}

function AccountCell({ account }: { account: PasskeyPopupAccount }) {
  return (
    <div className="tds-ppopup__cell">
      {account.icon ?? <Disc size={20} color="var(--sky-400)" />}
      <span className="tds-ppopup__cell-main">
        <Address
          value={account.address}
          leading={6}
          trailing={4}
          copy={false}
          className="tds-ppopup__addr"
        />
        <span className="tds-ppopup__cell-sub tds-ppopup__cell-sub--sm tds-ppopup__ellipsis">
          {account.label ?? "Passkey"}
        </span>
      </span>
      {account.balance != null && <span className="tds-ppopup__bal">{account.balance}</span>}
    </div>
  );
}

function Review({
  copy,
  site,
  loading,
  primaryRef,
  onContinue,
  onCancel,
}: {
  copy: FlowCopy;
  site?: PasskeyPopupSite | null;
  loading: boolean;
  primaryRef: React.Ref<HTMLElement>;
  onContinue?: () => void;
  onCancel?: () => void;
}) {
  const app = site?.name ?? "This app";
  const [confirmWith, receives] = copy.checklist(app);
  return (
    <>
      <SiteCell site={loading ? null : site} />
      <div className="tds-ppopup__head">
        <div className="tds-ppopup__title">{copy.title}</div>
        <div className="tds-ppopup__sub">
          {loading ? (
            <span className="tds-ppopup__pending">
              <Spinner tone="inherit" className="tds-ppopup__spin" />
              Waiting for app details…
            </span>
          ) : (
            copy.description(app)
          )}
        </div>
      </div>
      <Checklist
        variant="box"
        items={[
          confirmWith,
          loading ? <span className="tds-ppopup__skel tds-ppopup__skel--row" aria-hidden /> : receives,
        ]}
      />
      <div className="tds-ppopup__actions">
        <Button
          ref={primaryRef}
          variant="primary"
          className="tds-ppopup__btn"
          disabled={loading || !onContinue}
          onClick={onContinue}
        >
          {copy.continueLabel}
        </Button>
        {onCancel && (
          <Button variant="outline" className="tds-ppopup__btn" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </>
  );
}

function Signing({
  copy,
  site,
  slowAfterMs,
  onCancel,
}: {
  copy: FlowCopy;
  site?: PasskeyPopupSite | null;
  slowAfterMs: number;
  onCancel?: () => void;
}) {
  const { slow } = useWaitStages("signing", slowAfterMs, 0, false);
  const app = site?.name ?? "the app";
  return (
    <>
      <WaitHero
        size="lg"
        slow={slow}
        title={copy.signingTitle}
        content="Confirm with Touch ID, Face ID or your security key in the browser prompt."
      />
      <Steps
        className="tds-ppopup__steps"
        items={[
          { label: <>Request received from {site?.host ?? app}</>, status: "done" },
          { label: copy.activeStep, status: "active" },
          { label: <>Returning to {app}</>, status: "pending" },
        ]}
      />
      {onCancel && (
        <Button variant="outline" className="tds-ppopup__btn" onClick={onCancel}>
          Cancel
        </Button>
      )}
    </>
  );
}

/* ── Root ──────────────────────────────────────────────────────────── */
/**
 * PasskeyPopup — the first-party window (`app.tid.sh/passkey/popup`) the
 * wallet opens when a passkey ceremony cannot run inside its iframe. A 56px
 * lockup header with the host's lock tag, a centered 360px column, and a
 * footer saying why the window opened. Five states:
 *
 *   waiting → ready → signing → done | error
 *
 * Presentational: the page drives the state from its opener handshake. The
 * waiting state has the ready state's shape (skeleton origin cell, disabled
 * primary) so nothing jumps when the request arrives.
 */
export function PasskeyPopup({
  state,
  flow = "signin",
  env,
  site,
  account,
  errorTitle,
  errorDescription = DEFAULT_ERROR_DESCRIPTION,
  errorMessage,
  onContinue,
  onCancel,
  onRetry,
  onClose,
  footer = DEFAULT_FOOTER,
  autoFocus = true,
  slowAfterMs = WALLET_SHEET_SLOW_MS,
  className,
}: PasskeyPopupProps) {
  const copy = COPY[flow];
  const primaryRef = React.useRef<HTMLElement | null>(null);
  const app = site?.name ?? "the app";

  React.useEffect(() => {
    if (state === "ready" && autoFocus) primaryRef.current?.focus();
  }, [state, autoFocus]);

  const announcement =
    state === "waiting"
      ? "Waiting for app details"
      : state === "ready"
        ? `${copy.title}. Request from ${site?.host ?? app}.`
        : state === "signing"
          ? copy.signingTitle
          : state === "done"
            ? copy.doneTitle
            : (errorTitle ?? copy.errorTitle);

  let body: React.ReactNode;
  switch (state) {
    case "waiting":
    case "ready":
      body = (
        <Review
          copy={copy}
          site={site}
          loading={state === "waiting"}
          primaryRef={primaryRef}
          onContinue={onContinue}
          onCancel={onCancel}
        />
      );
      break;
    case "signing":
      body = <Signing copy={copy} site={site} slowAfterMs={slowAfterMs} onCancel={onCancel} />;
      break;
    case "done":
      body = (
        <>
          <Screen.Header
            size="lg"
            tone="success"
            icon={<Check width={22} height={22} />}
            title={copy.doneTitle}
            content={<>Returning you to {app}. This window closes on its own.</>}
          />
          {account && <AccountCell account={account} />}
          {onClose && (
            <Button variant="outline" className="tds-ppopup__btn" onClick={onClose}>
              Close window
            </Button>
          )}
        </>
      );
      break;
    case "error":
      body = (
        <>
          <Screen.Header
            size="lg"
            tone="danger"
            icon={<X width={20} height={20} />}
            title={errorTitle ?? copy.errorTitle}
            content={errorDescription}
          />
          {errorMessage && <ErrorBox message={errorMessage} />}
          <div className="tds-ppopup__actions">
            {onRetry && (
              <Button variant="primary" className="tds-ppopup__btn" onClick={onRetry}>
                Try again
              </Button>
            )}
            {onCancel && (
              <Button variant="outline" className="tds-ppopup__btn" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
        </>
      );
      break;
  }

  return (
    <div className={cn("tds-ppopup", className)} data-state={state}>
      <Bar env={env} />
      <div className="tds-ppopup__body">
        <div className="tds-ppopup__col">{body}</div>
      </div>
      {footer && <div className="tds-ppopup__foot">{footer}</div>}
      <div className="tds-ppopup__sr" role="status" aria-live="polite">
        {announcement}
      </div>
    </div>
  );
}
