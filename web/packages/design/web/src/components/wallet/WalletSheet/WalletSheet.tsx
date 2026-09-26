import * as React from "react";
import { cn } from "../../../utils";
import { Button } from "../../Button/Button";
import { Spinner } from "../../Spinner/Spinner";
import { Address } from "../../Address/Address";
import { Frame, type FrameProps } from "../Frame/Frame";
import { Screen } from "../Screen/Screen";
import { Steps, type StepItem } from "../Steps/Steps";
import { Checklist } from "../Checklist/Checklist";
import { Details } from "../Details/Details";
import { Disc } from "../Disc/Disc";
import { ThruDisc, PoweredBy } from "../Brand/Brand";
import { ErrorBox } from "../ErrorBox/ErrorBox";
import { TxTree } from "../TxTree/TxTree";
import { Collapsible } from "@base-ui/react/collapsible";
import { useWaitStages, WaitHero, WALLET_SHEET_SLOW_MS, WALLET_SHEET_ESCALATE_MS } from "./wait";
import { DepositScreens } from "./DepositScreens";
import { PairScreens } from "./PairScreens";
import "./WalletSheet.css";

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
const Shield = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <path d="M12 3l7 2.6v5.6c0 4.4-2.8 7.3-7 8.8-4.2-1.5-7-4.4-7-8.8V5.6L12 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
  </svg>
);
const ArrowUpRight = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <path d="M7 17 17 7M8 7h9v9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
  </svg>
);

/* ── Types ─────────────────────────────────────────────────────────── */
export type WalletSheetScreen =
  | "signin"
  | "loading"
  | "permissions"
  | "connected"
  | "error"
  | "tx"
  | "txPending"
  | "txDone"
  | "deposit"
  | "depositCrypto"
  | "depositCard"
  | "depositContact"
  | "depositVerify"
  | "depositPending"
  | "depositDone"
  | "pairIntro"
  | "pairCode"
  | "pairDone";

export type WalletSheetFlow = "signin" | "signup";

export interface WalletSheetDetail {
  label: React.ReactNode;
  value: React.ReactNode;
}

export { WALLET_SHEET_SLOW_MS, WALLET_SHEET_ESCALATE_MS } from "./wait";

/* ── Root ──────────────────────────────────────────────────────────── */
export type WalletSheetRootProps = FrameProps;

/** The sheet chrome — `Frame` with the wallet-sheet hook class. */
const Root = React.forwardRef<HTMLDivElement, WalletSheetRootProps>(function WalletSheetRoot(
  { className, ...props },
  ref,
) {
  return <Frame ref={ref} className={cn("tds-wsheet", className)} {...props} />;
});

/* ── Sign in ───────────────────────────────────────────────────────── */
export interface WalletSheetSignInProps {
  appName: React.ReactNode;
  description?: React.ReactNode;
  signInLabel?: React.ReactNode;
  createLabel?: React.ReactNode;
  onSignIn?: () => void;
  /** Omit to hide the "Create account" secondary action. */
  onCreateAccount?: () => void;
  poweredBy?: boolean;
}

function SignIn({
  appName,
  description,
  signInLabel = "Sign in with passkey",
  createLabel = "Create account",
  onSignIn,
  onCreateAccount,
  poweredBy = true,
}: WalletSheetSignInProps) {
  return (
    <>
      <Screen>
        <Screen.Header
          tone="plain"
          icon={<ThruDisc size={38} title="Thru Wallet" />}
          title={<>Sign in to {appName}</>}
          content={description}
        />
        <Button variant="primary" className="tds-wsheet__cta" onClick={onSignIn}>
          {signInLabel}
        </Button>
        {onCreateAccount && (
          <Button variant="outline" className="tds-wsheet__cta" onClick={onCreateAccount}>
            {createLabel}
          </Button>
        )}
      </Screen>
      {poweredBy && <PoweredBy />}
    </>
  );
}

/* ── Loading (creating account / waiting for passkey) ──────────────── */
export interface WalletSheetLoadingProps {
  flow?: WalletSheetFlow;
  appName: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Override the default three-step ladder. */
  steps?: StepItem[];
  slowAfterMs?: number;
  escalateAfterMs?: number;
  escalationMessage?: React.ReactNode;
  onRetry?: () => void;
  onCancel?: () => void;
  retryLabel?: React.ReactNode;
  cancelLabel?: React.ReactNode;
  poweredBy?: boolean;
}

function Loading({
  flow = "signup",
  appName,
  title,
  description,
  steps,
  slowAfterMs = WALLET_SHEET_SLOW_MS,
  escalateAfterMs = WALLET_SHEET_ESCALATE_MS,
  escalationMessage = "Still waiting. Passkey prompts can take a moment — check for a browser dialog.",
  onRetry,
  onCancel,
  retryLabel = "Retry",
  cancelLabel = "Cancel",
  poweredBy = true,
}: WalletSheetLoadingProps) {
  const signup = flow === "signup";
  const { slow, escalated } = useWaitStages(flow, slowAfterMs, escalateAfterMs, !!(onRetry || onCancel));
  const items: StepItem[] = steps ?? [
    { label: signup ? "Passkey created" : "Passkey verified", status: "done" },
    { label: signup ? "Deploying account" : "Restoring account", status: "active" },
    { label: <>Connecting to {appName}</>, status: "pending" },
  ];
  return (
    <>
      <Screen>
        <WaitHero
          slow={slow}
          title={title ?? (signup ? "Creating your account" : "Waiting for passkey")}
          content={
            description ??
            (signup
              ? "Approve the passkey prompt from your browser."
              : "Confirm with Touch ID, Face ID or your security key.")
          }
        />
        <Steps items={items} />
        {escalated && (
          <div className="tds-wsheet__escalation">
            <div className="tds-wsheet__escalation-text">{escalationMessage}</div>
            <div className="tds-wsheet__escalation-actions">
              {onRetry && (
                <Button variant="outline" size="sm" onClick={onRetry}>
                  {retryLabel}
                </Button>
              )}
              {onCancel && (
                <Button variant="ghost" size="sm" onClick={onCancel}>
                  {cancelLabel}
                </Button>
              )}
            </div>
          </div>
        )}
      </Screen>
      {poweredBy && <PoweredBy />}
    </>
  );
}

/* ── Permissions ───────────────────────────────────────────────────── */
export interface WalletSheetPermissionsProps {
  appName: React.ReactNode;
  /** Host shown in the subtitle ("meridian.xyz is asking to:"). */
  host: React.ReactNode;
  permissions: React.ReactNode[];
  details?: WalletSheetDetail[];
  detailsLabel?: React.ReactNode;
  detailsOpenLabel?: React.ReactNode;
  onCancel?: () => void;
  onConnect?: () => void;
  cancelLabel?: React.ReactNode;
  connectLabel?: React.ReactNode;
}

function Permissions({
  appName,
  host,
  permissions,
  details,
  detailsLabel = "Show details",
  detailsOpenLabel = "Hide details",
  onCancel,
  onConnect,
  cancelLabel = "Cancel",
  connectLabel = "Connect",
}: WalletSheetPermissionsProps) {
  return (
    <Screen
      footer={
        <Screen.Actions>
          <Button variant="outline" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant="primary" onClick={onConnect}>
            {connectLabel}
          </Button>
        </Screen.Actions>
      }
    >
      <Screen.Header
        icon={<Shield width={18} height={18} />}
        title={<>Connect to {appName}</>}
        content={<>{host} is asking to:</>}
      />
      <Checklist items={permissions} />
      {details && details.length > 0 && (
        <Details label={detailsLabel} openLabel={detailsOpenLabel}>
          {details.map((d, i) => (
            <Details.Item key={i} label={d.label} value={d.value} />
          ))}
        </Details>
      )}
    </Screen>
  );
}

/* ── Connected ─────────────────────────────────────────────────────── */
export interface WalletSheetConnectedProps {
  appName: React.ReactNode;
  address: string;
  balance?: React.ReactNode;
  /** Second line under the address (default "Passkey · Thru"). */
  authLabel?: React.ReactNode;
  avatar?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  onDone?: () => void;
  doneLabel?: React.ReactNode;
}

function Connected({
  appName,
  address,
  balance,
  authLabel = "Passkey · Thru",
  avatar,
  title = "Connected",
  description,
  onDone,
  doneLabel = "Done",
}: WalletSheetConnectedProps) {
  return (
    <Screen bottomAction={{ label: doneLabel, onClick: onDone }}>
      <Screen.Header
        tone="success"
        icon={<Check width={18} height={18} />}
        title={title}
        content={description ?? <>You&rsquo;re signed in to {appName}.</>}
      />
      <div className="tds-wsheet__account">
        {avatar ?? <Disc size={20} color="var(--sky-400)" />}
        <div className="tds-wsheet__account-main">
          <Address value={address} leading={6} trailing={4} className="tds-wsheet__account-addr" />
          <div className="tds-wsheet__account-sub">{authLabel}</div>
        </div>
        {balance != null && <span className="tds-wsheet__account-bal">{balance}</span>}
      </div>
    </Screen>
  );
}

/* ── Error ─────────────────────────────────────────────────────────── */
export interface WalletSheetErrorProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Raw error text, clamped to two lines with a copy affordance. */
  message?: string;
  onRetry?: () => void;
  onCancel?: () => void;
  retryLabel?: React.ReactNode;
  cancelLabel?: React.ReactNode;
  poweredBy?: boolean;
}

function ErrorScreen({
  title = "Couldn’t sign in",
  description = "The passkey request was cancelled or timed out.",
  message,
  onRetry,
  onCancel,
  retryLabel = "Try again",
  cancelLabel = "Cancel",
  poweredBy = true,
}: WalletSheetErrorProps) {
  return (
    <>
      <Screen>
        <Screen.Header tone="danger" icon={<X width={16} height={16} />} title={title} content={description} />
        {message && <ErrorBox message={message} />}
        {onRetry && (
          <Button variant="primary" className="tds-wsheet__cta" onClick={onRetry}>
            {retryLabel}
          </Button>
        )}
        {onCancel && (
          <Button variant="ghost" className="tds-wsheet__cta" onClick={onCancel}>
            {cancelLabel}
          </Button>
        )}
      </Screen>
      {poweredBy && <PoweredBy />}
    </>
  );
}

/* ── Approve transaction ───────────────────────────────────────────── */
export interface WalletSheetTxField {
  label: React.ReactNode;
  value: React.ReactNode;
}

export interface WalletSheetTxAccount {
  name: React.ReactNode;
  address: string;
  /** Role chips, e.g. ["signer", "writable"]. */
  roles?: React.ReactNode[];
}

export interface WalletSheetTxCall {
  /** `program::method`, shown in the call row. */
  name: React.ReactNode;
  /** Index into the transaction's program table. */
  programIdx: number | string;
  /** Payload size in bytes. */
  size: number;
  /** Hex payload, `0x`-prefixed. */
  data: string;
  /** Decoded fields as preformatted text (rendered in a sideways-scrolling box). */
  decoded?: React.ReactNode;
  /** Number of decoded fields, for the "decoded · N fields" meta. */
  fields?: number;
}

export interface WalletSheetTxInstruction {
  /** Decoded type of the instruction, e.g. "MulticallArgs". */
  typeName: React.ReactNode;
  /** Inner calls (a multicall); each gets a collapsible row. */
  calls?: WalletSheetTxCall[];
  /** Extra decoded content shown under the calls (a value tree). */
  children?: React.ReactNode;
  /** Open the instruction section by default (the design does). */
  defaultOpen?: boolean;
}

export interface WalletSheetTxApproveProps {
  appName: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Signing account address. */
  account: string;
  /** Target program address. */
  program: string;
  /** Human name of the program, shown dim before its address. */
  programName?: React.ReactNode;
  /** Extra label / value rows under the account + program. */
  summary?: WalletSheetDetail[];
  /** Transaction-level parameters (nonce, version, network, …). */
  parameters?: WalletSheetTxField[];
  /** Fee rows (fee payer, fee, compute / state / memory units, expiry) —
   *  the same figures the explorer shows for a landed transaction. */
  fees?: WalletSheetTxField[];
  feesLabel?: React.ReactNode;
  /** Accounts the transaction touches, with their roles. */
  accounts?: WalletSheetTxAccount[];
  /** The instruction data section; omit to hide it. */
  instruction?: WalletSheetTxInstruction;
  /** Raw transaction bytes as hex. */
  rawHex?: string;
  /** Byte length of `rawHex`; derived from the hex when omitted. */
  rawSize?: number;
  advancedLabel?: React.ReactNode;
  advancedOpenLabel?: React.ReactNode;
  defaultAdvancedOpen?: boolean;
  onCancel?: () => void;
  onApprove?: () => void;
  cancelLabel?: React.ReactNode;
  approveLabel?: React.ReactNode;
}

const ChevronDown = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
  </svg>
);

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function TxApprove({
  appName,
  title = "Approve transaction",
  description,
  account,
  program,
  programName,
  summary,
  parameters,
  fees,
  feesLabel = "Fees",
  accounts,
  instruction,
  rawHex,
  rawSize,
  advancedLabel = "Advanced",
  advancedOpenLabel = "Hide advanced",
  defaultAdvancedOpen = false,
  onCancel,
  onApprove,
  cancelLabel = "Cancel",
  approveLabel = "Sign and accept",
}: WalletSheetTxApproveProps) {
  const [advancedOpen, setAdvancedOpen] = React.useState(defaultAdvancedOpen);
  const bytes = rawSize ?? (rawHex ? Math.ceil(rawHex.replace(/^0x/i, "").length / 2) : 0);
  const hasParameters = !!parameters && parameters.length > 0;
  const hasFees = !!fees && fees.length > 0;
  const hasAccounts = !!accounts && accounts.length > 0;
  const hasInstruction = !!instruction;
  const hasRaw = !!rawHex;
  const hasAdvanced = hasParameters || hasFees || hasAccounts || hasInstruction || hasRaw;
  const calls = instruction?.calls ?? [];

  return (
    <Screen
      scroll
      className="tds-wsheet__tx"
      footer={
        <Screen.Actions className="tds-wsheet__tx-actions">
          <Button variant="outline" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant="primary" onClick={onApprove}>
            {approveLabel}
          </Button>
        </Screen.Actions>
      }
    >
      <Screen.Header
        icon={<ArrowUpRight width={18} height={18} />}
        title={title}
        content={description ?? <>{appName} wants to send this transaction. Does it look right?</>}
      />
      <Screen.Box className="tds-wsheet__summary">
        <div className="tds-wsheet__srow">
          <span className="tds-wsheet__eyebrow">Account</span>
          <Address value={account} leading={8} trailing={6} className="tds-wsheet__mono" />
        </div>
        <div className="tds-wsheet__srow">
          <span className="tds-wsheet__eyebrow">Program</span>
          <span className="tds-wsheet__program" title={program}>
            {programName != null && <span className="tds-wsheet__program-name">{programName}</span>}
            <Address value={program} leading={8} trailing={7} showTitle={false} className="tds-wsheet__mono" />
          </span>
        </div>
        {summary?.map((row, i) => (
          <div key={i} className="tds-wsheet__srow">
            <span className="tds-wsheet__eyebrow">{row.label}</span>
            <span className="tds-wsheet__mono tds-wsheet__srow-value">{row.value}</span>
          </div>
        ))}
      </Screen.Box>
      {hasAdvanced && (
        <Collapsible.Root
          className="tds-wsheet__advanced"
          open={advancedOpen}
          onOpenChange={setAdvancedOpen}
        >
          <Collapsible.Trigger className="tds-wsheet__advanced-trigger">
            <span>{advancedOpen ? advancedOpenLabel : advancedLabel}</span>
            <ChevronDown width={14} height={14} className="tds-wsheet__advanced-chev" />
          </Collapsible.Trigger>
          <Collapsible.Panel className="tds-wsheet__advanced-panel">
            <div className="tds-wsheet__advanced-body">
              <TxTree>
                {hasParameters && (
                  <TxTree.Section label="Parameters" meta={plural(parameters!.length, "field")}>
                    <TxTree.Rows>
                      {parameters!.map((row, i) => (
                        <TxTree.Row key={i} label={row.label} value={row.value} />
                      ))}
                    </TxTree.Rows>
                  </TxTree.Section>
                )}
                {hasFees && (
                  <TxTree.Section label={feesLabel} meta={plural(fees!.length, "field")}>
                    <TxTree.Rows>
                      {fees!.map((row, i) => (
                        <TxTree.Row key={i} label={row.label} value={row.value} />
                      ))}
                    </TxTree.Rows>
                  </TxTree.Section>
                )}
                {hasAccounts && (
                  <TxTree.Section label="Accounts" meta={accounts!.length}>
                    {accounts!.map((acct, i) => (
                      <TxTree.Account
                        key={i}
                        index={i}
                        name={acct.name}
                        address={acct.address}
                        roles={acct.roles}
                      />
                    ))}
                  </TxTree.Section>
                )}
                {hasInstruction && (
                  <TxTree.Section
                    label={<>Instruction data · {instruction!.typeName}</>}
                    meta={calls.length > 0 ? plural(calls.length, "call") : undefined}
                    defaultOpen={instruction!.defaultOpen ?? true}
                  >
                    {calls.map((call, i) => (
                      <TxTree.Section
                        key={i}
                        prefix={`[${i}]`}
                        label={call.name}
                        meta={`${call.size} B`}
                      >
                        <TxTree.Rows>
                          <TxTree.Row label="program_idx" value={call.programIdx} />
                          <TxTree.Row label="data_size" value={call.size} />
                        </TxTree.Rows>
                        {call.decoded != null && (
                          <TxTree.Section
                            variant="bare"
                            label="decoded"
                            meta={call.fields != null ? plural(call.fields, "field") : undefined}
                          >
                            <TxTree.Pre>{call.decoded}</TxTree.Pre>
                          </TxTree.Section>
                        )}
                        <TxTree.Rows>
                          <TxTree.Row label="data" value={<TxTree.Hex value={call.data} />} />
                        </TxTree.Rows>
                      </TxTree.Section>
                    ))}
                    {instruction!.children != null && (
                      <div className="tds-wsheet__ixdecode">{instruction!.children}</div>
                    )}
                  </TxTree.Section>
                )}
                {hasRaw && (
                  <TxTree.Section label="Raw bytes" meta={`${bytes} B`}>
                    <TxTree.Bytes hex={rawHex!} />
                  </TxTree.Section>
                )}
              </TxTree>
            </div>
          </Collapsible.Panel>
        </Collapsible.Root>
      )}
    </Screen>
  );
}

/* ── Approving (pending) ───────────────────────────────────────────── */
export interface WalletSheetTxPendingProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  steps?: StepItem[];
  slowAfterMs?: number;
  poweredBy?: boolean;
}

function TxPending({
  title = "Signing transaction",
  description = "Confirm with your passkey to sign.",
  steps,
  slowAfterMs = WALLET_SHEET_SLOW_MS,
  poweredBy = true,
}: WalletSheetTxPendingProps) {
  const { slow } = useWaitStages(undefined, slowAfterMs, 0, false);
  const items: StepItem[] = steps ?? [
    { label: "Signed with passkey", status: "done" },
    { label: "Submitting to Thru", status: "active" },
    { label: "Waiting for confirmation", status: "pending" },
  ];
  return (
    <>
      <Screen>
        <WaitHero slow={slow} title={title} content={description} />
        <Steps items={items} />
      </Screen>
      {poweredBy && <PoweredBy />}
    </>
  );
}

/* ── Approved (done) ───────────────────────────────────────────────── */
export interface WalletSheetTxDoneProps {
  appName: React.ReactNode;
  signature: string;
  /** Explorer link for the signature. */
  signatureHref?: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  onDone?: () => void;
  doneLabel?: React.ReactNode;
}

function TxDone({
  appName,
  signature,
  signatureHref,
  title = "Transaction submitted",
  description,
  onDone,
  doneLabel = "Done",
}: WalletSheetTxDoneProps) {
  return (
    <Screen bottomAction={{ label: doneLabel, onClick: onDone }}>
      <Screen.Header
        tone="success"
        icon={<Check width={18} height={18} />}
        title={title}
        content={description ?? <>{appName} will update once Thru confirms.</>}
      />
      <div className="tds-wsheet__sigrow">
        <span className="tds-wsheet__siglabel">Signature</span>
        <Address value={signature} leading={6} trailing={4} href={signatureHref} className="tds-wsheet__mono" />
      </div>
    </Screen>
  );
}

/**
 * WalletSheet — every screen the wallet iframe can show, as composable parts
 * inside the shared chrome:
 *
 *   <WalletSheet.Root site={{ label: "meridian.xyz", verified: true, tag: "mainnet" }} onClose={…}>
 *     <WalletSheet.SignIn appName="Meridian" onSignIn={…} onCreateAccount={…} />
 *   </WalletSheet.Root>
 *
 * Screens: SignIn, Loading, Permissions, Connected, Error, TxApprove,
 * TxPending, TxDone, and the Add funds set — Deposit (chooser), DepositCrypto,
 * DepositCard, DepositVerify, DepositPending, DepositDone, and the pair-a-new-
 * device set — PairIntro, PairCode, PairDone. All presentational —
 * the host drives the state machine.
 * Pair with `WalletOverlay` for the top-center island presentation.
 */
export const WalletSheet = {
  Root,
  SignIn,
  Loading,
  Permissions,
  Connected,
  Error: ErrorScreen,
  TxApprove,
  TxPending,
  TxDone,
  ...DepositScreens,
  ...PairScreens,
  PoweredBy,
};
