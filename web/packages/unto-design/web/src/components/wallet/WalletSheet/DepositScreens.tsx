import * as React from "react";
import { Select as BaseSelect } from "@base-ui/react/select";
import { Collapsible } from "@base-ui/react/collapsible";
import QRCode from "qrcode";
import { cn } from "../../../utils";
import { Button } from "../../Button/Button";
import { Checkbox } from "../../Checkbox/Checkbox";
import { Tag } from "../../Tag/Tag";
import { Input } from "../../Input/Input";
import { Spinner } from "../../Spinner/Spinner";
import { Stepper } from "../../Stepper/Stepper";
import { ToggleGroup } from "../../Toggle/Toggle";
import { shortenWalletAddress } from "../AccountMenu/AccountMenu";
import { Screen } from "../Screen/Screen";
import { Steps, type StepItem } from "../Steps/Steps";
import { Disc } from "../Disc/Disc";
import { useCopy } from "../CopyButton/CopyButton";
import { chainMeta } from "../registry";
import { WaitHero } from "./wait";
import "./DepositScreens.css";

const PlusCircle = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 5v6M5 8h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
  </svg>
);
const ChevronRight = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const ChevronLeft = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <path d="M10 4 6 8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const ChevronDown = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
  </svg>
);
const Check = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <path d="M3 8.5l3.5 3.5L13 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const CopyIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="0.5" stroke="currentColor" strokeWidth="1.3" />
    <path d="M10.5 5.5V3a.5.5 0 0 0-.5-.5H3a.5.5 0 0 0-.5.5v7a.5.5 0 0 0 .5.5h2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);
const CardIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <rect x="3" y="6" width="18" height="12" stroke="currentColor" strokeWidth="1.5" />
    <path d="M3 10h18" stroke="currentColor" strokeWidth="1.5" />
    <path d="M7 14.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
  </svg>
);
const BankIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
  </svg>
);
const DropIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <path
      d="M12 3.5c3 3.6 6 7.2 6 10.5a6 6 0 0 1-12 0c0-3.3 3-6.9 6-10.5Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path d="M9 14.5a3 3 0 0 0 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
const PhoneWaves = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <rect x="5" y="3" width="10" height="18" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M17.5 9a5 5 0 0 1 0 6M20 6.5a8.5 8.5 0 0 1 0 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
export const Lock = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <rect x="3" y="7" width="10" height="7" stroke="currentColor" strokeWidth="1.3" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);
const ShieldCheck = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <path d="M12 3 4.5 6v5.5c0 4.4 3.2 8 7.5 9.5 4.3-1.5 7.5-5.1 7.5-9.5V6L12 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="m9 12 2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** `faucet` is the test faucet a wallet offers in developer mode. */
export type WalletSheetDepositMethod = "crypto" | "card" | "bank" | "faucet";

export interface DepositDestinationInfo {
  /** Account name, e.g. "Main". */
  name: React.ReactNode;
  /** Full address; middle-truncated (6 … 4). */
  address: string;
  /** Avatar fill color for the account dot. */
  color?: string;
}

export interface DepositNetworkOption {
  /** Stable id passed back through `onNetworkChange`. */
  id: string;
  name: React.ReactNode;
  /** Registry chain id; supplies the logo when `logo` is omitted. */
  chainId?: number;
  /** Logo URL (a data URI from the registry works). */
  logo?: string;
}

export interface DepositPayMethodOption {
  id: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
}

function RailHeader({ title, description }: { title: React.ReactNode; description?: React.ReactNode }) {
  return (
    <div className="uds-dep__rail-head">
      <div className="uds-dep__rail-title">{title}</div>
      {description != null && <div className="uds-dep__rail-sub">{description}</div>}
    </div>
  );
}

/** Where a stepped flow is: the step being shown of how many. */
export interface DepositStepProgress {
  count: number;
  /** Zero-based. */
  active: number;
}

/** The rail header with the stepper over it (nothing below two steps). */
export function StepHeader({
  title,
  description,
  step,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  step?: DepositStepProgress;
}) {
  return (
    <div className="uds-dep__step-head">
      {step && <Stepper count={step.count} active={step.active} label="Deposit progress" />}
      <RailHeader title={title} description={description} />
    </div>
  );
}

function BackLink({ onClick, children }: { onClick?: () => void; children: React.ReactNode }) {
  return (
    <Button variant="ghost" size="sm" className="uds-dep__back" onClick={onClick}>
      <ChevronLeft width={12} height={12} />
      {children}
    </Button>
  );
}

interface DepositSelectItem {
  value: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
}

/** Field-labelled Base UI Select with an icon per item. */
function DepositSelect({
  label,
  items,
  value,
  onValueChange,
  disabled,
}: {
  label: React.ReactNode;
  items: DepositSelectItem[];
  value: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
}) {
  const current = items.find((it) => it.value === value) ?? items[0];
  return (
    <div className="uds-dep__field">
      <span className="uds-dep__label">{label}</span>
      <BaseSelect.Root
        items={items.map((it) => ({ value: it.value, label: it.label }))}
        value={value}
        onValueChange={(v) => onValueChange?.(v as string)}
        disabled={disabled}
      >
        <BaseSelect.Trigger className="uds-dep__select">
          {current?.icon != null && <span className="uds-dep__select-icon">{current.icon}</span>}
          <span className="uds-dep__select-value">{current?.label}</span>
          <BaseSelect.Icon className="uds-dep__select-chev">
            <ChevronDown width={14} height={14} />
          </BaseSelect.Icon>
        </BaseSelect.Trigger>
        <BaseSelect.Portal>
          <BaseSelect.Positioner
            className="uds-dep__positioner"
            sideOffset={4}
            align="start"
            alignItemWithTrigger={false}
          >
            <BaseSelect.Popup className="uds-dep__popup">
              {items.map((it) => (
                <BaseSelect.Item key={it.value} value={it.value} className="uds-dep__option">
                  {it.icon != null && <span className="uds-dep__select-icon">{it.icon}</span>}
                  <BaseSelect.ItemText className="uds-dep__option-text">{it.label}</BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator className="uds-dep__option-check">
                    <Check width={13} height={13} />
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.Popup>
          </BaseSelect.Positioner>
        </BaseSelect.Portal>
      </BaseSelect.Root>
    </div>
  );
}

function NetworkLogo({ option, size }: { option: DepositNetworkOption; size: number }) {
  const meta = option.chainId != null ? chainMeta(option.chainId) : undefined;
  const logo = option.logo ?? meta?.logo;
  if (logo) return <img src={logo} alt="" width={size} height={size} className="uds-dep__logo" />;
  return (
    <Disc
      size={size}
      color={meta?.color ?? "var(--color-surface-lower)"}
      glyph={meta?.glyph ?? (typeof option.name === "string" ? option.name[0] : "?")}
    />
  );
}

export interface DepositQrProps {
  /** Encoded payload — the deposit address. Omit for the loading placeholder. */
  value?: string;
  /** Outer box size in px (default 148). */
  size?: number;
  className?: string;
}

/**
 * DepositQr — a real QR, error-correction H so a logo can sit over the
 * centre.
 */
export function DepositQr({ value, size = 148, className }: DepositQrProps) {
  const matrix = React.useMemo(() => {
    if (!value) return null;
    try {
      const qr = QRCode.create(value, { errorCorrectionLevel: "H" });
      return { size: qr.modules.size, data: qr.modules.data };
    } catch {
      return null;
    }
  }, [value]);
  const inner = size - 16; /* 8px padding each side */
  return (
    <span
      className={cn("uds-dep__qr", !matrix && "uds-dep__qr--empty", className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {matrix && (
        <svg
          viewBox={`0 0 ${matrix.size} ${matrix.size}`}
          width={inner}
          height={inner}
          shapeRendering="crispEdges"
          className="uds-dep__qr-svg"
        >
          {Array.from(matrix.data).map((on, i) =>
            on ? (
              <rect key={i} x={i % matrix.size} y={Math.floor(i / matrix.size)} width={1} height={1} />
            ) : null,
          )}
        </svg>
      )}
    </span>
  );
}

/** The "hosted by Coinbase" chrome around Coinbase's own surface. */
export function CoinbaseFrame({
  host = "pay.coinbase.com",
  hostedBy = "hosted by Coinbase",
  children,
  className,
  bodyClassName,
}: {
  host?: React.ReactNode;
  hostedBy?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className={cn("uds-dep__cb", className)}>
      <div className="uds-dep__cb-head">
        <span className="uds-dep__cb-host">
          <Lock width={10} height={10} />
          {host}
        </span>
        <span>{hostedBy}</span>
      </div>
      <div className={cn("uds-dep__cb-body", bodyClassName)}>{children}</div>
    </div>
  );
}

/**
 * The card rail's pay action ("Continue with Apple Pay"), shown until an order
 * exists and Coinbase's own button takes over.
 */
export function DepositPayButton({
  children,
  onClick,
  disabled,
  loading,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}) {
  return (
    <Button
      variant="primary"
      className={cn("uds-wsheet__cta", className)}
      onClick={loading ? undefined : onClick}
      disabled={disabled}
      aria-busy={loading || undefined}
    >
      {loading && <Spinner tone="inherit" />}
      {children}
    </Button>
  );
}

export interface WalletSheetDepositProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Which rails to offer (default crypto and card). */
  methods?: WalletSheetDepositMethod[];
  cryptoTitle?: React.ReactNode;
  cryptoDescription?: React.ReactNode;
  /** Registry chain ids for the fanned logos (default Ethereum, Solana, Base). */
  cryptoChainIds?: number[];
  bankTitle?: React.ReactNode;
  bankDescription?: React.ReactNode;
  bankTag?: React.ReactNode;
  cardTitle?: React.ReactNode;
  cardDescription?: React.ReactNode;
  faucetTitle?: React.ReactNode;
  faucetDescription?: React.ReactNode;
  /** "Deposits land in ● Main · taAAAA…AAMD" footer; omit to hide. */
  destination?: DepositDestinationInfo;
  onCrypto?: () => void;
  onBank?: () => void;
  onCard?: () => void;
  onFaucet?: () => void;
  /**
   * Accordion mode: the method unfolded under its row (`null` = all folded).
   * The rows toggle instead of navigating — a row click calls `onCrypto` /
   * `onCard`, clicking the open row again calls `onCollapse` — and the rail
   * renders inside the row's panel. Leave unset for the plain chooser.
   */
  open?: WalletSheetDepositMethod | null;
  onCollapse?: () => void;
  /** Content unfolded under each method row (accordion mode). */
  cryptoPanel?: React.ReactNode;
  bankPanel?: React.ReactNode;
  cardPanel?: React.ReactNode;
  faucetPanel?: React.ReactNode;
  /** The panel bodies, for a host that renders into them (a portal). They
   *  stay mounted — hidden — while folded, so the refs are stable. */
  cryptoPanelRef?: React.Ref<HTMLDivElement>;
  bankPanelRef?: React.Ref<HTMLDivElement>;
  cardPanelRef?: React.Ref<HTMLDivElement>;
  faucetPanelRef?: React.Ref<HTMLDivElement>;
}

interface DepositMethodRowProps {
  tag?: React.ReactNode;
  art: React.ReactNode;
  title: React.ReactNode;
  description: React.ReactNode;
  onSelect?: () => void;
  /** Accordion mode when defined. */
  open?: boolean;
  onCollapse?: () => void;
  panel?: React.ReactNode;
  panelRef?: React.Ref<HTMLDivElement>;
}

/** One chooser row: a plain button, or (accordion mode) a collapsible whose
 *  panel unfolds the rail under the row. */
function DepositMethodRow({ art, title, description, tag, onSelect, open, onCollapse, panel, panelRef }: DepositMethodRowProps) {
  const row = (
    <>
      <span className="uds-dep__method-art">{art}</span>
      <span className="uds-dep__method-main">
        <span className="uds-dep__method-title">{title}</span>
        <span className="uds-dep__method-sub">{description}</span>
      </span>
      {tag != null && <Tag>{tag}</Tag>}
      <ChevronRight width={14} height={14} className="uds-dep__method-chev" />
    </>
  );
  if (open === undefined) {
    return (
      <button type="button" className="uds-dep__method" onClick={onSelect}>
        {row}
      </button>
    );
  }
  return (
    <Collapsible.Root
      open={open}
      onOpenChange={(next) => (next ? onSelect?.() : onCollapse?.())}
      className="uds-dep__item"
    >
      <Collapsible.Trigger className="uds-dep__method">{row}</Collapsible.Trigger>
      <Collapsible.Panel keepMounted className="uds-dep__panel">
        <div ref={panelRef} className="uds-dep__panel-body">
          {panel}
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

function DepositScreen({
  title = "Add funds",
  description = "Choose how to fund your Unto Wallet. Whatever you send, it arrives as $.",
  methods = ["crypto", "card"],
  cryptoTitle = "Deposit crypto",
  cryptoDescription = "Any chain, any token · from a wallet or exchange",
  cryptoChainIds = [1, 501, 8453],
  bankTitle = "Bank transfer",
  bankDescription = "US bank · 1-3 days",
  bankTag = "New",
  cardTitle = "Apple Pay or Google Pay",
  cardDescription = "Debit card via Coinbase · US only",
  faucetTitle = "Test faucet",
  faucetDescription = "Test tokens with no real value · developer mode",
  destination,
  onCrypto,
  onBank,
  onCard,
  onFaucet,
  open,
  onCollapse,
  cryptoPanel,
  bankPanel,
  cardPanel,
  faucetPanel,
  cryptoPanelRef,
  bankPanelRef,
  cardPanelRef,
  faucetPanelRef,
}: WalletSheetDepositProps) {
  const accordion = open !== undefined;
  return (
    <Screen className={cn(accordion && "uds-dep__chooser--accordion")}>
      <Screen.Header icon={<PlusCircle width={18} height={18} />} title={title} content={description} />
      <div className="uds-dep__methods">
        {methods.includes("crypto") && (
          <DepositMethodRow
            art={cryptoChainIds.map((id) => (
              <span key={id} className="uds-dep__fan">
                <NetworkLogo option={{ id: String(id), name: chainMeta(id).name, chainId: id }} size={22} />
              </span>
            ))}
            title={cryptoTitle}
            description={cryptoDescription}
            onSelect={onCrypto}
            open={accordion ? open === "crypto" : undefined}
            onCollapse={onCollapse}
            panel={cryptoPanel}
            panelRef={cryptoPanelRef}
          />
        )}
        {methods.includes("bank") && (
          <DepositMethodRow
            art={<span className="uds-dep__method-glyph"><BankIcon width={20} height={20} /></span>}
            title={bankTitle}
            description={bankDescription}
            tag={bankTag}
            onSelect={onBank}
            open={accordion ? open === "bank" : undefined}
            onCollapse={onCollapse}
            panel={bankPanel}
            panelRef={bankPanelRef}
          />
        )}
        {methods.includes("card") && (
          <DepositMethodRow
            art={
              <span className="uds-dep__method-glyph">
                <CardIcon width={20} height={20} />
              </span>
            }
            title={cardTitle}
            description={cardDescription}
            onSelect={onCard}
            open={accordion ? open === "card" : undefined}
            onCollapse={onCollapse}
            panel={cardPanel}
            panelRef={cardPanelRef}
          />
        )}
        {methods.includes("faucet") && (
          <DepositMethodRow
            art={
              <span className="uds-dep__method-glyph">
                <DropIcon width={20} height={20} />
              </span>
            }
            title={faucetTitle}
            description={faucetDescription}
            onSelect={onFaucet}
            open={accordion ? open === "faucet" : undefined}
            onCollapse={onCollapse}
            panel={faucetPanel}
            panelRef={faucetPanelRef}
          />
        )}
      </div>
      {destination && (
        <div className="uds-dep__lands">
          <span>Deposits land in</span>
          <span className="uds-dep__lands-acct" title={destination.address}>
            <span className="uds-dep__lands-dot" style={{ background: destination.color ?? "#0279b1" }} />
            {destination.name} · {shortenWalletAddress(destination.address)}
          </span>
        </div>
      )}
    </Screen>
  );
}

export interface WalletSheetDepositAgreementProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  step?: DepositStepProgress;
  agreementLabel: React.ReactNode;
  agreementHref: string;
  openLabel?: React.ReactNode;
  children: React.ReactNode;
  agreed: boolean;
  onAgreedChange: (agreed: boolean) => void;
  agreeLabel: React.ReactNode;
  continueLabel?: React.ReactNode;
  onContinue: () => void;
  embedded?: boolean;
}

function DepositAgreement({
  title,
  description,
  step,
  agreementLabel,
  agreementHref,
  openLabel = "Open",
  children,
  agreed,
  onAgreedChange,
  agreeLabel,
  continueLabel = "Continue",
  onContinue,
  embedded = false,
}: WalletSheetDepositAgreementProps) {
  const labelId = React.useId();
  const content = (
    <>
      <StepHeader title={title} description={description} step={step} />
      <section className="uds-dep__field" aria-labelledby={labelId}>
        <div className="uds-dep__agreement-label">
          <span id={labelId} className="uds-dep__label">{agreementLabel}</span>
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<a href={agreementHref} target="_blank" rel="noopener noreferrer" aria-label="Open End-User Agreement" />}
          >
            {openLabel}
          </Button>
        </div>
        <div className="uds-dep__agreement-box" tabIndex={0}>{children}</div>
      </section>
      <Checkbox className="uds-dep__agree" checked={agreed} onCheckedChange={onAgreedChange}>
        {agreeLabel}
      </Checkbox>
      <Button variant="primary" className="uds-wsheet__cta" disabled={!agreed} onClick={onContinue}>
        {continueLabel}
      </Button>
    </>
  );
  if (embedded) return <div className="uds-dep__agreement uds-dep__embedded">{content}</div>;
  return <Screen className="uds-dep__agreement">{content}</Screen>;
}

export interface WalletSheetDepositCryptoProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  networkLabel?: React.ReactNode;
  networks: DepositNetworkOption[];
  /** Selected network id. */
  network: string;
  onNetworkChange?: (id: string) => void;
  /** The deposit address; omit while it is being created (skeleton). */
  address?: string;
  /** QR payload; defaults to the address. */
  qrValue?: string;
  addressLabel?: React.ReactNode;
  copyLabel?: React.ReactNode;
  copiedLabel?: React.ReactNode;
  /** How long "Copied" shows (default 1200 ms). */
  copiedMs?: number;
  /** Extra content between the address block and the back link. */
  children?: React.ReactNode;
  onBack?: () => void;
  backLabel?: React.ReactNode;
  /** Render only the fields — no header, screen padding or back link — for
   *  the chooser's accordion panel. */
  embedded?: boolean;
}

function DepositCrypto({
  title = "Deposit crypto",
  description = "Send tokens from any network. Deposits settle as $.",
  networkLabel = "Network",
  networks,
  network,
  onNetworkChange,
  address,
  qrValue,
  addressLabel,
  copyLabel = "Copy address",
  copiedLabel = "Copied",
  copiedMs = 1200,
  children,
  onBack,
  backLabel = "Other ways to add funds",
  embedded = false,
}: WalletSheetDepositCryptoProps) {
  const { copy, notifying } = useCopy(copiedMs);
  const current = networks.find((n) => n.id === network) ?? networks[0];
  const fields = (
    <>
      <DepositSelect
        label={networkLabel}
        items={networks.map((n) => ({
          value: n.id,
          label: n.name,
          icon: <NetworkLogo option={n} size={16} />,
        }))}
        value={current?.id ?? network}
        onValueChange={onNetworkChange}
      />
      <div className="uds-dep__qr-row">
        <DepositQr value={qrValue ?? address} />
      </div>
      <div className="uds-dep__field">
        <span className="uds-dep__label">
          {addressLabel ?? <>Your {current?.name} address</>}
        </span>
        <div className={cn("uds-dep__addr", !address && "uds-dep__addr--empty")}>
          {address ?? " "}
        </div>
        <Button
          variant="outline"
          className="uds-wsheet__cta"
          disabled={!address}
          onClick={() => address && copy(address)}
        >
          {notifying ? (
            <span className="uds-dep__copy-check">
              <Check width={13} height={13} />
            </span>
          ) : (
            <CopyIcon width={14} height={14} />
          )}
          {notifying ? copiedLabel : copyLabel}
        </Button>
      </div>
      {children}
    </>
  );
  if (embedded) {
    return <div className="uds-dep__crypto uds-dep__embedded">{fields}</div>;
  }
  return (
    <Screen className="uds-dep__crypto">
      <RailHeader title={title} description={description} />
      {fields}
      {onBack && <BackLink onClick={onBack}>{backLabel}</BackLink>}
    </Screen>
  );
}

export const COINBASE_GUEST_CHECKOUT_TERMS_HREF = "https://www.coinbase.com/legal/guest-checkout/us";
export const COINBASE_USER_AGREEMENT_HREF = "https://www.coinbase.com/legal/user_agreement";
export const COINBASE_PRIVACY_POLICY_HREF = "https://www.coinbase.com/legal/privacy";

/** Coinbase's required disclosure, verbatim. */
export function CoinbaseTerms({ className }: { className?: string }) {
  return (
    <div className={cn("uds-dep__terms", className)}>
      By proceeding with this payment, you agree to Coinbase’s{" "}
      <a href={COINBASE_GUEST_CHECKOUT_TERMS_HREF} target="_blank" rel="noopener">
        Guest Checkout Terms of Service
      </a>
      ,{" "}
      <a href={COINBASE_USER_AGREEMENT_HREF} target="_blank" rel="noopener">
        User Agreement
      </a>{" "}
      and{" "}
      <a href={COINBASE_PRIVACY_POLICY_HREF} target="_blank" rel="noopener">
        Privacy Policy
      </a>
      .
    </div>
  );
}

export const DEFAULT_DEPOSIT_PAY_METHODS: DepositPayMethodOption[] = [
  { id: "apple_pay", label: "Apple Pay" },
  { id: "google_pay", label: "Google Pay" },
];
export const DEFAULT_DEPOSIT_PRESETS = [25, 50, 100, 250];

export interface WalletSheetDepositCardProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  payLabel?: React.ReactNode;
  payMethods?: DepositPayMethodOption[];
  payMethod: string;
  onPayMethodChange?: (id: string) => void;
  amountLabel?: React.ReactNode;
  /** Whole USD amount shown in the panel. */
  amount: number;
  presets?: number[];
  onAmountChange?: (amount: number) => void;
  /** Formatted receive amount, e.g. "$49.00"; omit to hide the line. */
  receive?: React.ReactNode;
  /** Formatted fee, e.g. "$1.00". */
  fee?: React.ReactNode;
  /** Replace Coinbase's disclosure (keep the wording when you do). */
  terms?: React.ReactNode;
  /** What sits inside the Coinbase frame: a pay button or Coinbase's iframe.
      Omitted on the amount step of a stepped flow, which ends in Continue. */
  frame?: React.ReactNode;
  frameHost?: React.ReactNode;
  frameHostedBy?: React.ReactNode;
  /** Draw the "hosted by Coinbase" box around `frame`; off when Coinbase's
      surface lives in its own window and that window carries the chrome. */
  frameChrome?: boolean;
  /** Freeze the inputs (an order is in flight). */
  disabled?: boolean;
  onBack?: () => void;
  backLabel?: React.ReactNode;
  /** Render only the fields — no header, screen padding or back link — for
   *  the chooser's accordion panel. */
  embedded?: boolean;
  /** Ask for Coinbase's guest-checkout contact right here, above the pay
   *  button, instead of on a separate step. */
  contact?: DepositCardContactProps;
  /** The amount step of a stepped flow: a Continue button sits under the
   *  amount instead of the contact, terms and pay button. */
  onContinue?: () => void;
  continueLabel?: React.ReactNode;
  continueDisabled?: boolean;
  step?: DepositStepProgress;
}

export interface DepositCardContactProps {
  phone: DepositContactFieldProps;
  email: DepositContactFieldProps;
  phoneLabel?: React.ReactNode;
  emailLabel?: React.ReactNode;
  /** Why we ask (default: Coinbase's first-purchase note). */
  note?: React.ReactNode;
}

/** The "$ 50 USD" panel: a free amount input with the presets as shortcuts.
 *  Keeps what the user typed ("25.") until it parses to a new amount. */
function AmountField({
  label,
  amount,
  presets,
  onAmountChange,
  disabled,
}: {
  label: React.ReactNode;
  amount: number;
  presets: number[];
  onAmountChange?: (amount: number) => void;
  disabled?: boolean;
}) {
  const format = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2));
  const [text, setText] = React.useState(() => format(amount));
  const lastAmountRef = React.useRef(amount);
  React.useEffect(() => {
    if (amount === lastAmountRef.current) return;
    lastAmountRef.current = amount;
    setText(format(amount));
  }, [amount]);
  const onInput = (raw: string) => {
    const cleaned = raw.replace(/[^0-9.]/g, "");
    const [whole, ...rest] = cleaned.split(".");
    const next = rest.length > 0 ? `${whole}.${rest.join("").slice(0, 2)}` : whole;
    /* A paste too long to be a finite number is dropped whole, so the field
       never shows an amount the quote and the order do not use. */
    const parsed = next === "" || next === "." ? 0 : Number(next);
    if (!Number.isFinite(parsed)) return;
    setText(next);
    lastAmountRef.current = parsed;
    onAmountChange?.(parsed);
  };
  const ariaLabel = typeof label === "string" ? label : undefined;
  return (
    <div className="uds-dep__field">
      <span className="uds-dep__label">{label}</span>
      <Input
        size="lg"
        inputMode="decimal"
        autoComplete="off"
        aria-label={ariaLabel}
        value={text}
        onChange={(event) => onInput(event.target.value)}
        disabled={disabled}
      />
      <ToggleGroup.Group
        className="uds-dep__presets"
        aria-label={ariaLabel}
        value={presets.includes(amount) ? [String(amount)] : []}
        onValueChange={(values) => {
          /* Single choice: pressing the selected preset again keeps it. */
          const next = values[0];
          if (next !== undefined) onAmountChange?.(Number(next));
        }}
        disabled={disabled}
      >
        {presets.map((v) => (
          <ToggleGroup.Item key={v} value={String(v)} className="uds-dep__preset">
            ${v}
          </ToggleGroup.Item>
        ))}
      </ToggleGroup.Group>
    </div>
  );
}

function DepositCard({
  title = "Add $",
  description = "Apple Pay or Google Pay · US only",
  payLabel = "Pay with",
  payMethods = DEFAULT_DEPOSIT_PAY_METHODS,
  payMethod,
  onPayMethodChange,
  amountLabel = "You pay",
  amount,
  presets = DEFAULT_DEPOSIT_PRESETS,
  onAmountChange,
  receive,
  fee,
  terms,
  frame,
  frameHost,
  frameHostedBy,
  frameChrome = true,
  disabled,
  onBack,
  backLabel = "Other ways to add funds",
  embedded = false,
  contact,
  onContinue,
  continueLabel = "Continue",
  continueDisabled,
  step,
}: WalletSheetDepositCardProps) {
  const stepped = onContinue !== undefined;
  const fields = (
    <>
      <DepositSelect
        label={payLabel}
        items={payMethods.map((m) => ({
          value: m.id,
          label: m.label,
          icon: m.icon ?? <PhoneWaves width={16} height={16} />,
        }))}
        value={payMethod}
        onValueChange={onPayMethodChange}
        disabled={disabled}
      />
      <div className="uds-dep__field">
        <AmountField label={amountLabel} amount={amount} presets={presets} onAmountChange={onAmountChange} disabled={disabled} />
        {(receive != null || fee != null) && (
          <div className="uds-dep__quote">
            <span>
              {receive != null && (
                <>
                  You receive <strong>≈ {receive}</strong>
                </>
              )}
            </span>
            {fee != null && <span>Fee {fee}</span>}
          </div>
        )}
      </div>
      {stepped && (
        <Button variant="primary" className="uds-wsheet__cta" onClick={onContinue} disabled={continueDisabled}>
          {continueLabel}
        </Button>
      )}
      {!stepped && contact && (
        <div className="uds-dep__contact-form uds-dep__card-contact">
          <div className="uds-dep__rail-sub">
            {contact.note ??
              "Coinbase needs a US mobile number and an email for guest checkout. First purchase only · they text you a code."}
          </div>
          <ContactFields
            phone={contact.phone}
            email={contact.email}
            phoneLabel={contact.phoneLabel}
            emailLabel={contact.emailLabel}
            disabled={disabled}
          />
        </div>
      )}
      {!stepped && (terms ?? <CoinbaseTerms />)}
      {!stepped &&
        (frameChrome ? (
          <CoinbaseFrame host={frameHost} hostedBy={frameHostedBy}>
            {frame}
          </CoinbaseFrame>
        ) : (
          <div className="uds-dep__cb-bare">{frame}</div>
        ))}
    </>
  );
  if (embedded) {
    return (
      <div className="uds-dep__card uds-dep__embedded">
        {description != null && <div className="uds-dep__rail-sub">{description}</div>}
        {fields}
      </div>
    );
  }
  return (
    <Screen scroll className="uds-dep__card">
      <StepHeader title={title} description={description} step={step} />
      {fields}
      {onBack && <BackLink onClick={onBack}>{backLabel}</BackLink>}
    </Screen>
  );
}

const DEFAULT_FAUCET_PRESETS = [10, 100, 1000];

/** The test faucet's drop, for a faucet option in a Pay with select. */
export const DepositFaucetIcon = DropIcon;

export interface WalletSheetDepositFaucetProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  amountLabel?: React.ReactNode;
  /** Amount of test tokens to request. */
  amount: number;
  presets?: number[];
  onAmountChange?: (amount: number) => void;
  onSubmit?: () => void;
  submitLabel?: React.ReactNode;
  /** A funding request is in flight: the inputs freeze and the button spins. */
  submitting?: boolean;
  submittingLabel?: React.ReactNode;
  /** The button can't be used yet (e.g. no amount, or the account isn't ready). */
  disabled?: boolean;
  /** A Pay with select above the button, when the faucet is one of several
   *  ways to pay (developer mode on the card sheet). */
  payLabel?: React.ReactNode;
  payMethods?: DepositPayMethodOption[];
  payMethod?: string;
  onPayMethodChange?: (id: string) => void;
  onBack?: () => void;
  backLabel?: React.ReactNode;
  /** Render only the fields — no header, screen padding or back link — for
   *  the chooser's accordion panel. */
  embedded?: boolean;
}

function DepositFaucet({
  title = "Test faucet",
  description = "Adds test tokens with no real value. Only on test networks.",
  amountLabel = "Amount",
  amount,
  presets = DEFAULT_FAUCET_PRESETS,
  onAmountChange,
  onSubmit,
  submitLabel = "Get test tokens",
  submitting = false,
  submittingLabel = "Funding…",
  disabled = false,
  payLabel = "Pay with",
  payMethods,
  payMethod,
  onPayMethodChange,
  onBack,
  backLabel = "Other ways to add funds",
  embedded = false,
}: WalletSheetDepositFaucetProps) {
  const fields = (
    <>
      <AmountField
        label={amountLabel}
        amount={amount}
        presets={presets}
        onAmountChange={onAmountChange}
        disabled={submitting}
      />
      {payMethods && payMethods.length > 0 && (
        <DepositSelect
          label={payLabel}
          items={payMethods.map((m) => ({
            value: m.id,
            label: m.label,
            icon: m.icon ?? <PhoneWaves width={16} height={16} />,
          }))}
          value={payMethod ?? payMethods[0].id}
          onValueChange={onPayMethodChange}
          disabled={submitting}
        />
      )}
      <Button
        variant="primary"
        className="uds-wsheet__cta"
        onClick={onSubmit}
        disabled={disabled || submitting}
        aria-busy={submitting || undefined}
      >
        {submitting && <Spinner tone="inherit" />}
        {submitting ? submittingLabel : submitLabel}
      </Button>
    </>
  );
  if (embedded) {
    return (
      <div className="uds-dep__faucet uds-dep__embedded">
        <RailHeader title={title} description={description} />
        {fields}
      </div>
    );
  }
  return (
    <Screen className="uds-dep__faucet">
      <RailHeader title={title} description={description} />
      {fields}
      {onBack && <BackLink onClick={onBack}>{backLabel}</BackLink>}
    </Screen>
  );
}

export interface DepositContactFieldProps {
  /** National US digits for the phone field, or the email as typed. */
  value: string;
  onChange: (value: string) => void;
  /** Inline validation message; the field is drawn in its error state when set. */
  error?: React.ReactNode;
}

export interface WalletSheetDepositContactProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  phone: DepositContactFieldProps;
  email: DepositContactFieldProps;
  phoneLabel?: React.ReactNode;
  emailLabel?: React.ReactNode;
  /** Runs on submit (Enter or the button). */
  onContinue: () => void;
  continueLabel?: React.ReactNode;
  /** Button text while loading (the passkey / order round trip). */
  loadingLabel?: React.ReactNode;
  /** Disable the fields and the button (an order is in flight). */
  disabled?: boolean;
  loading?: boolean;
  onBack?: () => void;
  backLabel?: React.ReactNode;
}

/** The US mobile field: the country code is a fixed readout, the field takes
 *  the national digits. */
function PhoneField({
  phone,
  label = "Mobile number",
  disabled,
  autoFocus,
}: {
  phone: DepositContactFieldProps;
  label?: React.ReactNode;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div className="uds-dep__contact-field">
      <div className="uds-dep__contact-phone">
        <span className="uds-dep__contact-cc" aria-hidden="true">
          🇺🇸 +1
        </span>
        <Input
          label={typeof label === "string" ? label : undefined}
          aria-label={typeof label === "string" ? label : "Mobile number"}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="415 555 0121"
          size="lg"
          text="ui"
          value={phone.value}
          onChange={(event) => phone.onChange(event.target.value)}
          error={phone.error != null}
          disabled={disabled}
          autoFocus={autoFocus}
          wrapperClassName="uds-dep__contact-input"
        />
      </div>
      {phone.error != null && <span className="uds-dep__contact-error">{phone.error}</span>}
    </div>
  );
}

function EmailField({
  email,
  label = "Email",
  disabled,
  autoFocus,
}: {
  email: DepositContactFieldProps;
  label?: React.ReactNode;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div className="uds-dep__contact-field">
      <Input
        label={typeof label === "string" ? label : undefined}
        aria-label={typeof label === "string" ? label : "Email"}
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="you@example.com"
        size="lg"
        text="body"
        value={email.value}
        onChange={(event) => email.onChange(event.target.value)}
        error={email.error != null}
        disabled={disabled}
        autoFocus={autoFocus}
        wrapperClassName="uds-dep__contact-input"
      />
      {email.error != null && <span className="uds-dep__contact-error">{email.error}</span>}
    </div>
  );
}

/** The US mobile + email pair, with our own inline messages. */
function ContactFields({
  phone,
  email,
  phoneLabel = "Mobile number",
  emailLabel = "Email",
  disabled,
}: {
  phone: DepositContactFieldProps;
  email: DepositContactFieldProps;
  phoneLabel?: React.ReactNode;
  emailLabel?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <>
      <PhoneField phone={phone} label={phoneLabel} disabled={disabled} />
      <EmailField email={email} label={emailLabel} disabled={disabled} />
    </>
  );
}

/**
 * The contact Coinbase's guest checkout needs before it can hand out an
 * Apple Pay / Google Pay link: a US mobile number (Coinbase texts a code the
 * first time) and an email for the receipt. Shown once per account; the
 * wallet remembers the answer.
 */
function DepositContact({
  title = "Your details",
  description = "Coinbase needs a US mobile number and an email for guest checkout. First purchase only · they text you a code.",
  phone,
  email,
  phoneLabel = "Mobile number",
  emailLabel = "Email",
  onContinue,
  continueLabel = "Continue",
  loadingLabel = "Confirming…",
  disabled,
  loading,
  onBack,
  backLabel = "Back",
}: WalletSheetDepositContactProps) {
  return (
    <Screen scroll className="uds-dep__contact">
      <RailHeader title={title} description={description} />
      <form
        className="uds-dep__contact-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!disabled && !loading) onContinue();
        }}
      >
        <ContactFields phone={phone} email={email} phoneLabel={phoneLabel} emailLabel={emailLabel} disabled={disabled} />
        <Button type="submit" variant="primary" className="uds-wsheet__cta" disabled={disabled || loading}>
          {loading ? loadingLabel : continueLabel}
        </Button>
      </form>
      {onBack && <BackLink onClick={onBack}>{backLabel}</BackLink>}
    </Screen>
  );
}

interface StepFormProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  step?: DepositStepProgress;
  onContinue: () => void;
  continueLabel?: React.ReactNode;
  /** The step can't go on yet (the field isn't valid). */
  disabled?: boolean;
  children: React.ReactNode;
}

/** One question and a Continue button; Enter continues too. */
function StepForm({ title, description, step, onContinue, continueLabel = "Continue", disabled, children }: StepFormProps) {
  return (
    <Screen className="uds-dep__contact">
      <StepHeader title={title} description={description} step={step} />
      <form
        className="uds-dep__contact-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!disabled) onContinue();
        }}
      >
        {children}
        <Button type="submit" variant="primary" className="uds-wsheet__cta" disabled={disabled}>
          {continueLabel}
        </Button>
      </form>
    </Screen>
  );
}

export interface WalletSheetDepositPhoneProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  step?: DepositStepProgress;
  phone: DepositContactFieldProps;
  phoneLabel?: React.ReactNode;
  onContinue: () => void;
  continueLabel?: React.ReactNode;
  disabled?: boolean;
}

/** Coinbase's guest checkout needs a US mobile number; it texts a code the
 *  first time. */
function DepositPhone({
  title = "Your phone number",
  description = "Enter your 10-digit US phone number to continue.",
  step,
  phone,
  phoneLabel = "Mobile number",
  onContinue,
  continueLabel,
  disabled,
}: WalletSheetDepositPhoneProps) {
  return (
    <StepForm
      title={title}
      description={description}
      step={step}
      onContinue={onContinue}
      continueLabel={continueLabel}
      disabled={disabled}
    >
      <PhoneField phone={phone} label={phoneLabel} autoFocus />
    </StepForm>
  );
}

export interface WalletSheetDepositEmailProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  step?: DepositStepProgress;
  email: DepositContactFieldProps;
  emailLabel?: React.ReactNode;
  onContinue: () => void;
  continueLabel?: React.ReactNode;
  disabled?: boolean;
}

/** Coinbase's receipt goes to this email. */
function DepositEmail({
  title = "Add your email",
  description = "Enter your email to continue.",
  step,
  email,
  emailLabel = "Email",
  onContinue,
  continueLabel,
  disabled,
}: WalletSheetDepositEmailProps) {
  return (
    <StepForm
      title={title}
      description={description}
      step={step}
      onContinue={onContinue}
      continueLabel={continueLabel}
      disabled={disabled}
    >
      <EmailField email={email} label={emailLabel} autoFocus />
    </StepForm>
  );
}

export interface WalletSheetDepositReviewProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  step?: DepositStepProgress;
  /** The order: You pay, Fee, You receive. */
  rows: WalletSheetDepositDoneRow[];
  payLabel?: React.ReactNode;
  payMethods?: DepositPayMethodOption[];
  payMethod: string;
  onPayMethodChange?: (id: string) => void;
  /** Where Coinbase's receipt goes, with an Edit that reopens the contact steps. */
  receipt?: { value: React.ReactNode; onEdit?: () => void; label?: React.ReactNode; editLabel?: React.ReactNode };
  /** Replace Coinbase's disclosure (keep the wording when you do). */
  terms?: React.ReactNode;
  /** The pay button, or where the order stands once it exists. */
  frame: React.ReactNode;
  /** Freeze the choices (an order is in flight). */
  disabled?: boolean;
}

/** The last step: the order as Coinbase will run it, then the pay button. */
function DepositReview({
  title = "Confirm order",
  description,
  step,
  rows,
  payLabel = "Pay with",
  payMethods = DEFAULT_DEPOSIT_PAY_METHODS,
  payMethod,
  onPayMethodChange,
  receipt,
  terms,
  frame,
  disabled,
}: WalletSheetDepositReviewProps) {
  return (
    <Screen scroll className="uds-dep__card">
      <StepHeader title={title} description={description} step={step} />
      <div className="uds-dep__rows">
        {rows.map((row, i) => (
          <div key={i} className="uds-dep__row">
            <span className="uds-dep__row-label">{row.label}</span>
            <span className={cn("uds-dep__row-value", row.strong && "uds-dep__row-value--strong")}>{row.value}</span>
          </div>
        ))}
      </div>
      <DepositSelect
        label={payLabel}
        items={payMethods.map((m) => ({
          value: m.id,
          label: m.label,
          icon: m.icon ?? <PhoneWaves width={16} height={16} />,
        }))}
        value={payMethod}
        onValueChange={onPayMethodChange}
        disabled={disabled}
      />
      {receipt && (
        <div className="uds-dep__receipt">
          <div className="uds-dep__receipt-copy">
            <span className="uds-dep__receipt-label">{receipt.label ?? "Sending receipts to"}</span>
            <span className="uds-dep__receipt-value">{receipt.value}</span>
          </div>
          {receipt.onEdit && (
            <Button variant="ghost" size="sm" onClick={receipt.onEdit} disabled={disabled}>
              {receipt.editLabel ?? "Edit"}
            </Button>
          )}
        </div>
      )}
      {terms ?? <CoinbaseTerms />}
      <div className="uds-dep__cb-bare">{frame}</div>
    </Screen>
  );
}

export interface WalletSheetDepositVerifyProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Coinbase's verification surface (their iframe), inside the frame chrome. */
  children: React.ReactNode;
  frameHost?: React.ReactNode;
  frameHostedBy?: React.ReactNode;
  onCancel?: () => void;
  cancelLabel?: React.ReactNode;
  attribution?: React.ReactNode;
}

function DepositVerify({
  title = "Verify with Coinbase",
  description = "First purchase only. Coinbase confirms your phone, then remembers you for 60 days.",
  children,
  frameHost,
  frameHostedBy,
  onCancel,
  cancelLabel = "Cancel purchase",
  attribution = "Verification by Coinbase",
}: WalletSheetDepositVerifyProps) {
  return (
    <Screen scroll className="uds-dep__verify">
      <Screen.Header icon={<ShieldCheck width={18} height={18} />} title={title} content={description} />
      <CoinbaseFrame host={frameHost} hostedBy={frameHostedBy} bodyClassName="uds-dep__cb-body--tall">
        {children}
      </CoinbaseFrame>
      <div className="uds-dep__verify-foot">
        {onCancel ? <BackLink onClick={onCancel}>{cancelLabel}</BackLink> : <span />}
        <span className="uds-dep__attribution">{attribution}</span>
      </div>
    </Screen>
  );
}

export interface WalletSheetDepositPendingProps {
  step?: DepositStepProgress;
  method?: WalletSheetDepositMethod;
  title?: React.ReactNode;
  description?: React.ReactNode;
  steps?: StepItem[];
  note?: React.ReactNode;
  onClose?: () => void;
  closeLabel?: React.ReactNode;
}

function DepositPending({
  step,
  method = "crypto",
  title,
  description,
  steps,
  note = "Safe to close. We’ll notify you when it lands.",
  onClose,
  closeLabel = "Close",
}: WalletSheetDepositPendingProps) {
  return (
    <Screen>
      {step && (
        <div className="uds-dep__pending-progress">
          <Stepper count={step.count} active={step.active} label="Deposit progress" />
        </div>
      )}
      <WaitHero
        title={
          title ??
          (method === "card"
            ? "Processing payment"
            : method === "faucet"
              ? "Adding test tokens"
              : "Deposit detected")
        }
        content={description}
      />
      {steps && <Steps items={steps} />}
      <div className="uds-dep__pending-foot">
        <span className="uds-dep__note">{note}</span>
        {onClose && (
          <Button variant="ghost" size="sm" onClick={onClose}>
            {closeLabel}
          </Button>
        )}
      </div>
    </Screen>
  );
}

export interface WalletSheetDepositVerifiedProps {
  title?: React.ReactNode;
  step?: DepositStepProgress;
  items: StepItem[];
  onDone: () => void;
  doneLabel?: React.ReactNode;
  /** The button can't be used yet (the bank details are still being set up). */
  disabled?: boolean;
  /** Read out by screen readers when it changes, e.g. "Bank details ready". */
  announce?: React.ReactNode;
}

function DepositVerified({
  title = "You’re verified",
  step,
  items,
  onDone,
  doneLabel = "Done",
  disabled,
  announce,
}: WalletSheetDepositVerifiedProps) {
  return (
    <Screen>
      <StepHeader title={title} step={step} />
      <Steps items={items} />
      <span role="status" className="uds-dep__sr-status">
        {announce}
      </span>
      <Button variant="primary" className="uds-wsheet__cta" onClick={onDone} disabled={disabled}>
        {doneLabel}
      </Button>
    </Screen>
  );
}

export interface WalletSheetDepositDoneRow {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Semibold value (the new balance). */
  strong?: boolean;
}

export interface WalletSheetDepositDoneProps {
  /** Mono headline, e.g. "+$250.00". */
  amount: React.ReactNode;
  description?: React.ReactNode;
  rows?: WalletSheetDepositDoneRow[];
  onDone?: () => void;
  doneLabel?: React.ReactNode;
}

function DepositDone({ amount, description, rows, onDone, doneLabel = "Done" }: WalletSheetDepositDoneProps) {
  return (
    <Screen>
      <Screen.Header
        tone="success"
        icon={<Check width={18} height={18} />}
        title={amount}
        content={description}
        className="uds-dep__done-head"
      />
      {rows && rows.length > 0 && (
        <div className="uds-dep__rows">
          {rows.map((row, i) => (
            <div key={i} className="uds-dep__row">
              <span className="uds-dep__row-label">{row.label}</span>
              <span className={cn("uds-dep__row-value", row.strong && "uds-dep__row-value--strong")}>{row.value}</span>
            </div>
          ))}
        </div>
      )}
      <Button variant="primary" className="uds-wsheet__cta" onClick={onDone}>
        {doneLabel}
      </Button>
    </Screen>
  );
}

export const DepositScreens = {
  Deposit: DepositScreen,
  DepositCrypto,
  DepositAgreement,
  DepositCard,
  DepositFaucet,
  DepositContact,
  DepositPhone,
  DepositEmail,
  DepositReview,
  DepositVerify,
  DepositPending,
  DepositVerified,
  DepositDone,
};
