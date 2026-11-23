import * as React from "react";
import { cn } from "../../../utils";
import { Button } from "../../Button/Button";
import { Skeleton } from "../../Skeleton/Skeleton";
import { Tabs } from "../../Tabs/Tabs";
import { Tag } from "../../Tag/Tag";
import { CopyButton } from "../CopyButton/CopyButton";
import { Screen } from "../Screen/Screen";
import { StepGlyph } from "../Steps/Steps";
import { StepHeader } from "./DepositScreens";
import "./DepositScreens.css";

const Clock = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM12 7v5l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
  </svg>
);

export interface WalletSheetDepositBankRow {
  label: string;
  /** Shown, and what the copy button copies. */
  value: string;
  /** Set the value in mono (numbers). */
  mono?: boolean;
  /** The copy button's accessible name, e.g. "Copy routing number". */
  copyLabel: string;
}

/** One way to send the money, e.g. ACH: its tab and the details that method asks for. */
export interface WalletSheetDepositBankMethod {
  id: string;
  /** The tab's text. */
  label: string;
  /** How long this method takes, shown under its rows. */
  wait?: React.ReactNode;
  rows: WalletSheetDepositBankRow[];
}

export interface WalletSheetDepositBankDetailsProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** One tab each. The first one is selected. */
  methods: WalletSheetDepositBankMethod[];
  onDone: () => void;
  doneLabel?: React.ReactNode;
  onHistory: () => void;
  historyLabel?: React.ReactNode;
  /** A test-only action under the history link (simulate a deposit). */
  testAction?: { label: React.ReactNode; onClick: () => void };
}

/** Where to send USD: a tab per transfer method, and that method's bank details, each with a copy button. */
export function DepositBankDetails({
  title = "Your bank details",
  description = "Send USD from any US bank.",
  methods,
  onDone,
  doneLabel = "Done",
  onHistory,
  historyLabel = "Deposit history",
  testAction,
}: WalletSheetDepositBankDetailsProps) {
  const [copied, setCopied] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!copied) return;
    // Cleared so copying the same row again is announced again.
    const timer = window.setTimeout(() => setCopied(null), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <Screen>
      <StepHeader title={title} description={description} />
      <Tabs.Root defaultValue={methods[0]?.id}>
        <Tabs.List aria-label="Transfer method">
          {methods.map((method) => (
            <Tabs.Tab key={method.id} value={method.id} className="uds-dep__bank-tab">
              {method.label}
            </Tabs.Tab>
          ))}
          <Tabs.Indicator />
        </Tabs.List>
        {methods.map((method) => (
          <Tabs.Panel key={method.id} value={method.id} className="uds-dep__bank-panel">
            <div className="uds-dep__list" role="list">
              {method.rows.map((row) => (
                <div key={row.label} className="uds-dep__list-row" role="listitem">
                  <div className="uds-dep__receipt-copy uds-dep__list-text">
                    <span className="uds-dep__list-sub">{row.label}</span>
                    <span className={cn("uds-dep__receipt-value", row.mono && "uds-dep__list-mono")}>{row.value}</span>
                  </div>
                  <CopyButton
                    variant="icon"
                    value={row.value}
                    aria-label={row.copyLabel}
                    className="uds-dep__list-copy"
                    onCopied={() => setCopied(row.label)}
                  />
                </div>
              ))}
            </div>
            {method.wait && (
              <Tag>
                <Clock width={12} height={12} />
                {method.wait}
              </Tag>
            )}
          </Tabs.Panel>
        ))}
      </Tabs.Root>
      <span role="status" className="uds-dep__sr-status">
        {copied && `${copied} copied`}
      </span>
      <Button variant="primary" className="uds-wsheet__cta" onClick={onDone}>
        {doneLabel}
      </Button>
      <Button variant="ghost" className="uds-wsheet__cta" onClick={onHistory}>
        {historyLabel}
      </Button>
      {testAction && (
        <Button variant="ghost" className="uds-wsheet__cta" onClick={testAction.onClick}>
          {testAction.label}
        </Button>
      )}
    </Screen>
  );
}

export interface WalletSheetDepositActivityRow {
  id: string;
  tone: "pending" | "done" | "failed";
  /** "On its way", "Added", "Returned". */
  title: React.ReactNode;
  /** Mono line under the title: the rail, then the wait, date or reason. */
  detail: React.ReactNode;
  amount: React.ReactNode;
}

export interface WalletSheetDepositActivityProps {
  title?: React.ReactNode;
  rows: WalletSheetDepositActivityRow[];
  /** The first load: placeholder rows until there are rows to show. */
  loading?: boolean;
  /** Shown under the title once loaded with no rows. */
  emptyLabel?: React.ReactNode;
  onBankDetails: () => void;
  bankDetailsLabel?: React.ReactNode;
}

/** The wallet's bank deposits and where each one stands. */
export function DepositActivity({
  title = "Deposits",
  rows,
  loading,
  emptyLabel = "No deposits yet",
  onBankDetails,
  bankDetailsLabel = "Show bank details",
}: WalletSheetDepositActivityProps) {
  const placeholder = loading && rows.length === 0;
  return (
    <Screen className="uds-dep__activity">
      <StepHeader title={title} description={rows.length === 0 && !loading ? emptyLabel : undefined} />
      {(rows.length > 0 || placeholder) && (
        <div className="uds-dep__list" role="list" aria-busy={placeholder || undefined}>
          {placeholder
            ? [0, 1].map((i) => (
                <div key={i} className="uds-dep__list-row" role="listitem">
                  <Skeleton width="100%" height={28} />
                </div>
              ))
            : rows.map((row) => (
                <div key={row.id} className="uds-dep__list-row" role="listitem">
                  <StepGlyph status={row.tone === "pending" ? "active" : row.tone} />
                  <div className="uds-dep__list-text">
                    <span className="uds-dep__receipt-value">{row.title}</span>
                    <span className="uds-dep__activity-detail">{row.detail}</span>
                  </div>
                  <span className={cn("uds-dep__activity-amount", row.tone === "failed" && "uds-dep__activity-amount--failed")}>
                    {row.amount}
                  </span>
                </div>
              ))}
        </div>
      )}
      <Button variant="outline" className="uds-wsheet__cta" onClick={onBankDetails}>
        {bankDetailsLabel}
      </Button>
    </Screen>
  );
}
