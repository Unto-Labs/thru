import * as React from "react";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Radio } from "@base-ui/react/radio";
import { Button } from "../../Button/Button";
import { Input } from "../../Input/Input";
import { PasskeyIcon } from "../../PasskeyIcon/PasskeyIcon";
import { Skeleton } from "../../Skeleton/Skeleton";
import { Spinner } from "../../Spinner/Spinner";
import { ToggleGroup } from "../../Toggle/Toggle";
import { IdentityNumberInput } from "../IdentityNumberInput/IdentityNumberInput";
import { IDENTITY_FORMATS } from "../IdentityNumberInput/identity";
import { Screen } from "../Screen/Screen";
import { Steps, type StepStatus } from "../Steps/Steps";
import { StepHeader } from "./DepositScreens";
import "../../RadioGroup/RadioGroup.css";
import "./DepositScreens.css";
import "./CashOut.css";

const ArrowUpRight = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <path d="M7 17 17 7M8 7h9v9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
  </svg>
);
const Bank = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
  </svg>
);
const Plus = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
  </svg>
);
const ChevronRight = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
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

/** A payout bank as the user knows it: Brale returns no bank name, so the account type and the last digits. */
export interface WalletSheetCashOutBank {
  id: string;
  /** "Checking". */
  title: string;
  /** Shown as given, e.g. "····1234". */
  detail: string;
  /** Read out before the detail and not shown, e.g. "ending in". */
  detailLabel?: string;
}

export interface WalletSheetCashOutSpeed {
  id: string;
  /** "Same-day ACH". */
  title: string;
  /** When it arrives, e.g. "Today". */
  detail: string;
}

const Detail = ({ item }: { item: WalletSheetCashOutBank }) => {
  if (!item.detailLabel) return <>{item.detail}</>;
  const mask = item.detail.match(/^\D*/)![0];
  return (
    <>
      <span aria-hidden>{mask}</span>
      <span className="tds-dep__sr-status">{item.detailLabel} </span>
      {item.detail.slice(mask.length)}
    </>
  );
};

const BankLine = ({ bank }: { bank: WalletSheetCashOutBank }) => (
  <span>
    to {bank.title}{" "}
    <span className="tds-cashout__mono">
      <Detail item={bank} />
    </span>
  </span>
);

function Choices({
  label,
  items,
  value,
  onValueChange,
  art,
  children,
}: {
  label: string;
  items: WalletSheetCashOutBank[];
  value?: string;
  onValueChange: (id: string) => void;
  art?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const labelId = React.useId();
  return (
    <div className="tds-cashout__group">
      <div id={labelId} className="tds-field__label">
        {label}
      </div>
      <div className="tds-cashout__choices">
        {items.length > 0 && (
          <RadioGroup
            // Never undefined, which would let the group keep its own selection.
            value={value ?? ""}
            onValueChange={(next) => onValueChange(next as string)}
            aria-labelledby={labelId}
            className="tds-cashout__choices"
          >
            {items.map((item) => (
              <label key={item.id} className="tds-dep__method tds-cashout__choice">
                {art && (
                  <span className="tds-dep__method-art">
                    <span className="tds-dep__method-glyph">{art}</span>
                  </span>
                )}
                <span className="tds-dep__method-main">
                  <span className="tds-dep__method-title">{item.title}</span>
                  {item.detail && (
                    <span className="tds-dep__method-sub">
                      <Detail item={item} />
                    </span>
                  )}
                </span>
                <Radio.Root value={item.id} className="tds-radio__circle">
                  <span className="tds-radio__dot" />
                </Radio.Root>
              </label>
            ))}
          </RadioGroup>
        )}
        {children}
      </div>
    </div>
  );
}

export interface WalletSheetCashOutProps {
  /** The wallet's balance, formatted. Left out when the sheet does not know it. */
  balance?: string;
  banks: WalletSheetCashOutBank[];
  bankId?: string;
  onBankChange: (id: string) => void;
  onAddBank: () => void;
  onContinue: () => void;
  /** The first load: a placeholder until there are banks to show. */
  loading?: boolean;
}

/** Where the money goes: the user's banks, one selected, and a way to add another. */
export function CashOut({ balance, banks, bankId, onBankChange, onAddBank, onContinue, loading }: WalletSheetCashOutProps) {
  return (
    <Screen>
      <Screen.Header
        className="tds-cashout__head"
        icon={<ArrowUpRight width={18} height={18} />}
        title="Cash out"
        content={
          balance != null && (
            <>
              <span className="tds-cashout__amount">{balance}</span>
              <span>Available</span>
            </>
          )
        }
      />
      <div className="tds-cashout__group">
        <Choices label="To" items={banks} value={bankId} onValueChange={onBankChange} art={<Bank width={20} height={20} />}>
          {loading && banks.length === 0 && (
            <div aria-busy="true">
              <Skeleton width="100%" height={56} />
            </div>
          )}
          <button type="button" className="tds-dep__method" onClick={onAddBank}>
            <span className="tds-dep__method-art">
              <span className="tds-dep__method-glyph">
                <Plus width={20} height={20} />
              </span>
            </span>
            <span className="tds-dep__method-main">
              <span className="tds-dep__method-title">Add a US bank</span>
            </span>
            <ChevronRight width={14} height={14} className="tds-dep__method-chev" />
          </button>
        </Choices>
        <p className="tds-cashout__note">US bank accounts only.</p>
      </div>
      <Button
        variant="primary"
        className="tds-wsheet__cta"
        disabled={!banks.some((bank) => bank.id === bankId)}
        onClick={onContinue}
      >
        Continue
      </Button>
    </Screen>
  );
}

interface CashOutBankValues {
  owner: string;
  routing_number: string;
  account_number: string;
  account_number_confirm: string;
  account_type: "checking" | "savings";
}

export interface WalletSheetCashOutBankProps {
  values: CashOutBankValues;
  onFieldChange: <K extends keyof CashOutBankValues>(field: K, value: CashOutBankValues[K]) => void;
  errors?: Partial<Record<keyof CashOutBankValues, string>>;
  /** Raise it on each refused submit: the first invalid field takes focus. */
  errorAttempt?: number;
  submitting?: boolean;
  /** A line over the button, e.g. why the bank was not saved. */
  notice?: string;
  onSubmit: () => void;
}

/** The details of a US bank account to pay out to. */
export function CashOutBank({
  values,
  onFieldChange,
  errors = {},
  errorAttempt = 0,
  submitting,
  notice,
  onSubmit,
}: WalletSheetCashOutBankProps) {
  const formRef = React.useRef<HTMLFormElement>(null);
  const typeId = React.useId();
  React.useEffect(() => {
    if (errorAttempt) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errorAttempt]);

  return (
    <Screen>
      <StepHeader title="US bank account" />
      <form
        ref={formRef}
        noValidate
        className="tds-cashout__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!submitting) onSubmit();
        }}
      >
        <Input
          size="lg"
          text="body"
          label="Name on account"
          autoComplete="name"
          maxLength={100}
          value={values.owner}
          onChange={(event) => onFieldChange("owner", event.target.value)}
          errorMessage={errors.owner}
        />
        <Input
          size="lg"
          label="Routing number"
          inputMode="numeric"
          autoComplete="off"
          placeholder="9 digits"
          value={values.routing_number}
          // No maxLength: the browser would cut a pasted "021 000 021" before the spaces are stripped.
          onChange={(event) => onFieldChange("routing_number", event.target.value.replace(/\D/g, "").slice(0, 9))}
          errorMessage={errors.routing_number}
        />
        <IdentityNumberInput
          kind="bank_account"
          label="Account number"
          value={values.account_number}
          onValueChange={(value) => onFieldChange("account_number", value)}
          error={errors.account_number}
        />
        <Input
          size="lg"
          label="Confirm account number"
          inputMode="numeric"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          value={values.account_number_confirm}
          onChange={(event) =>
            onFieldChange("account_number_confirm", IDENTITY_FORMATS.bank_account.normalize(event.target.value))
          }
          errorMessage={errors.account_number_confirm}
        />
        <div className="tds-field">
          <span id={typeId} className="tds-field__label">
            Account type
          </span>
          <ToggleGroup.Group
            aria-labelledby={typeId}
            className="tds-cashout__type"
            value={[values.account_type]}
            // Pressing the chosen type again would clear it; one of the two always stays chosen.
            onValueChange={([next]) => next && onFieldChange("account_type", next as CashOutBankValues["account_type"])}
          >
            <ToggleGroup.Item value="checking">Checking</ToggleGroup.Item>
            <ToggleGroup.Item value="savings">Savings</ToggleGroup.Item>
          </ToggleGroup.Group>
          {errors.account_type && <p className="tds-cashout__error">{errors.account_type}</p>}
        </div>
        <p className="tds-cashout__note">Only the format is checked. Wrong numbers bounce back.</p>
        {notice && (
          <div className="tds-dep__note" role="status">
            {notice}
          </div>
        )}
        <Button
          type="submit"
          variant="primary"
          className="tds-wsheet__cta"
          disabled={submitting}
          aria-busy={submitting || undefined}
        >
          {submitting && <Spinner tone="inherit" />}
          Save bank
        </Button>
      </form>
    </Screen>
  );
}

/** A lone comma with at most two digits after it: the decimal comma some phone keyboards type in place of a point ("5,50" is 5.50). */
const DECIMAL_COMMA = /^(\d*),(\d{0,2})$/;
/** What a typed amount means: digits with at most one point and two decimals. A comma that is not a decimal comma groups thousands ("1,234.50") and is dropped. */
const dollars = (text: string) =>
  text.replace(DECIMAL_COMMA, "$1.$2").replace(/[^0-9.]/g, "").match(/^\d*(\.\d{0,2})?/)?.[0] ?? "";

export interface WalletSheetCashOutAmountProps {
  /** What the user typed, without the "$": "25", "25.5", "". */
  amount: string;
  onAmountChange: (text: string) => void;
  /** The wallet's balance, formatted. Left out when the sheet does not know it. */
  balance?: string;
  /** Draws the Max button. */
  onMax?: () => void;
  error?: string;
  speeds: WalletSheetCashOutSpeed[];
  speedId: string;
  onSpeedChange: (id: string) => void;
  onReview: () => void;
  disabled?: boolean;
}

/** How much to cash out and how fast. */
export function CashOutAmount({
  amount,
  onAmountChange,
  balance,
  onMax,
  error,
  speeds,
  speedId,
  onSpeedChange,
  onReview,
  disabled,
}: WalletSheetCashOutAmountProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  /* A decimal comma stays in the field as typed: "1," may still become "1,5" (1.5) or "1,234"
     (1234), so turning it into a point early would change the amount. Anything else shows
     `amount`. */
  const [typed, setTyped] = React.useState("");
  const shown = DECIMAL_COMMA.test(typed) && dollars(typed) === amount ? typed : amount;
  React.useEffect(() => {
    if (error) inputRef.current?.focus();
  }, [error]);
  return (
    <Screen>
      <StepHeader title="Cash out" />
      <div className="tds-cashout__group">
        <Input
          ref={inputRef}
          size="lg"
          inputMode="decimal"
          autoComplete="off"
          placeholder="$0.00"
          aria-label="Amount in dollars"
          value={shown && `$${shown}`}
          onChange={(event) => {
            const text = event.target.value.replace(/[^0-9.,]/g, "");
            setTyped(text);
            onAmountChange(dollars(text));
          }}
          errorMessage={error}
          trailing={
            onMax && (
              <Button variant="ghost" size="sm" type="button" className="tds-cashout__max" onClick={onMax}>
                Max
              </Button>
            )
          }
        />
        {balance != null && (
          <div className="tds-dep__quote">
            <span>
              <strong>{balance}</strong> available
            </span>
          </div>
        )}
      </div>
      <Choices label="Speed" items={speeds} value={speedId} onValueChange={onSpeedChange} />
      <Button variant="primary" className="tds-wsheet__cta" disabled={disabled} onClick={onReview}>
        Review
      </Button>
    </Screen>
  );
}

export interface WalletSheetCashOutReviewProps {
  /** Formatted, e.g. "$25.00". */
  amount: string;
  bank?: WalletSheetCashOutBank;
  rows: { label: string; value: string }[];
  /** What confirming does, e.g. "Funds leave your wallet now." */
  note: string;
  submitting?: boolean;
  error?: string;
  onConfirm: () => void;
}

/** The payout as it will be sent, and the passkey button that sends it. */
export function CashOutReview({ amount, bank, rows, note, submitting, error, onConfirm }: WalletSheetCashOutReviewProps) {
  return (
    <Screen>
      <Screen.Header
        className="tds-cashout__head"
        icon={<ArrowUpRight width={18} height={18} />}
        title="Review"
        content={
          <>
            <span className="tds-cashout__amount">{amount}</span>
            {bank && <BankLine bank={bank} />}
          </>
        }
      />
      <dl className="tds-dep__rows tds-cashout__rows">
        {rows.map((row) => (
          <div key={row.label} className="tds-dep__row">
            <dt className="tds-dep__row-label">{row.label}</dt>
            <dd className="tds-dep__row-value">{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="tds-cashout__note">{note}</p>
      {error && (
        <p className="tds-cashout__error" role="alert">
          {error}
        </p>
      )}
      <Button
        variant="primary"
        className="tds-wsheet__cta"
        disabled={submitting}
        aria-busy={submitting || undefined}
        onClick={onConfirm}
      >
        {submitting ? <Spinner tone="inherit" /> : <PasskeyIcon />}
        Confirm with passkey
      </Button>
    </Screen>
  );
}

export interface WalletSheetCashOutStatusProps {
  status: "sending" | "processing" | "sent" | "failed";
  /** Formatted, e.g. "$25.00". */
  amount?: string;
  bank?: WalletSheetCashOutBank;
  /** When the money reaches the bank, e.g. "Today". Shown until it has. */
  arrives?: string;
  onDone: () => void;
  /** Where "Contact support" goes on a failed payout. No button without it. */
  supportHref?: string;
}

const HEADLINES: Record<WalletSheetCashOutStatusProps["status"], string> = {
  sending: "Sending",
  processing: "On its way",
  sent: "Sent to your bank",
  failed: "Payout failed",
};

const step = (label: string, status: StepStatus, detail?: string) => ({
  label: (
    <>
      {status === "done" && <span className="tds-dep__sr-status">Done: </span>}
      {label}
    </>
  ),
  status,
  detail,
});

/** Where a payout stands, from leaving the wallet to reaching the bank. */
export function CashOutStatus({ status, amount, bank, arrives, onDone, supportHref }: WalletSheetCashOutStatusProps) {
  const sending = status === "sending";
  const sent = status === "sent";
  const failed = status === "failed";
  return (
    <Screen>
      <Screen.Header
        className="tds-cashout__head"
        tone={sent ? "success" : failed ? "danger" : "neutral"}
        icon={
          sent ? (
            <Check width={18} height={18} />
          ) : failed ? (
            <X width={16} height={16} />
          ) : (
            // The headline is the status region; the spinner only decorates it.
            <Spinner tone="brick" role={undefined} aria-label={undefined} aria-hidden />
          )
        }
        title={
          <span role="status" className="tds-cashout__status">
            {HEADLINES[status]}
            {failed && <span className="tds-cashout__status-note">Contact support to get your funds back.</span>}
          </span>
        }
        content={
          !failed &&
          (amount != null || bank) && (
            <>
              {amount != null && <span className="tds-cashout__amount">{amount}</span>}
              {bank && <BankLine bank={bank} />}
            </>
          )
        }
      />
      {!failed && (
        <Steps
          items={[
            step("Sent from wallet", sending ? "active" : "done"),
            step("Processing", sending ? "pending" : sent ? "done" : "active"),
            step("In your bank", sent ? "done" : "pending", sent ? undefined : arrives),
          ]}
        />
      )}
      {failed && supportHref && (
        <Button
          variant="primary"
          className="tds-wsheet__cta tds-cashout__support"
          nativeButton={false}
          render={<a href={supportHref} target="_blank" rel="noopener noreferrer" />}
        >
          Contact support
        </Button>
      )}
      <Button variant={failed && supportHref ? "ghost" : "primary"} className="tds-wsheet__cta" onClick={onDone}>
        Done
      </Button>
    </Screen>
  );
}
