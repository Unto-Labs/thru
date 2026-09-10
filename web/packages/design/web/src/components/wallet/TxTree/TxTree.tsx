import * as React from "react";
import { Collapsible } from "@base-ui/react/collapsible";
import { cn } from "../../../utils";
import { Address } from "../../Address/Address";
import { CopyButton } from "../CopyButton/CopyButton";
import "./TxTree.css";

const ChevronRight = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/* Nesting depth drives the indent (18px per level past the first). */
const DepthContext = React.createContext(0);

function useIndent(depth: number) {
  const triggerLeft = depth === 0 ? 8 : 20 + (depth - 1) * 18;
  const bodyLeft = depth === 0 ? 26 : 38 + (depth - 1) * 18;
  return {
    "--tds-txtree-trigger-left": `${triggerLeft}px`,
    "--tds-txtree-body-left": `${bodyLeft}px`,
  } as React.CSSProperties;
}

/* ── Section ──────────────────────────────────────────────────────── */
export interface TxTreeSectionProps {
  /** Row label (mono). */
  label: React.ReactNode;
  /** Right-aligned meta, e.g. "7 fields", "64 B". */
  meta?: React.ReactNode;
  /** Optional dim prefix before the label, e.g. "[1]". */
  prefix?: React.ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * `box` (default) — top-level sections sit in their own hairline box;
   * nested sections separate with a hairline top rule.
   * `bare` — an inline toggle with no rule or hover fill (the "decoded"
   * toggle inside a call), whose body has no extra indent.
   */
  variant?: "box" | "bare";
  className?: string;
  children?: React.ReactNode;
}

/**
 * A collapsible node. Nest freely: each level indents 18px further and the
 * chevron turns as it opens. Built on Base UI `Collapsible`.
 */
function Section({
  label,
  meta,
  prefix,
  defaultOpen = false,
  open,
  onOpenChange,
  variant = "box",
  className,
  children,
}: TxTreeSectionProps) {
  const depth = React.useContext(DepthContext);
  const indent = useIndent(depth);
  return (
    <Collapsible.Root
      className={cn(
        "tds-txtree__section",
        depth === 0 ? "tds-txtree__section--root" : "tds-txtree__section--nested",
        variant === "bare" && "tds-txtree__section--bare",
        className,
      )}
      style={indent}
      defaultOpen={defaultOpen}
      open={open}
      onOpenChange={onOpenChange}
    >
      <Collapsible.Trigger className="tds-txtree__trigger">
        <ChevronRight width={12} height={12} className="tds-txtree__chev" />
        {prefix != null && <span className="tds-txtree__dim">{prefix}</span>}
        <span className="tds-txtree__label">{label}</span>
        {meta != null && <span className="tds-txtree__meta">{meta}</span>}
      </Collapsible.Trigger>
      <Collapsible.Panel className="tds-txtree__panel">
        <DepthContext.Provider value={depth + 1}>
          <div className="tds-txtree__body">{children}</div>
        </DepthContext.Provider>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

/* ── Leaf rows ────────────────────────────────────────────────────── */
export interface TxTreeRowProps {
  label: React.ReactNode;
  value: React.ReactNode;
  className?: string;
}

/** A key / value leaf (mono 11px): dim label on the left, value on the right. */
function Row({ label, value, className }: TxTreeRowProps) {
  return (
    <div className={cn("tds-txtree__row", className)}>
      <span className="tds-txtree__dim">{label}</span>
      <span className="tds-txtree__value">{value}</span>
    </div>
  );
}

/** A group of leaf rows with the design's 5px rhythm. */
function Rows({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("tds-txtree__rows", className)}>{children}</div>;
}

const shortHex = (hex: string) => (hex.length > 16 ? `${hex.slice(0, 8)}…${hex.slice(-4)}` : hex);

export interface TxTreeHexProps {
  value: string;
  "aria-label"?: string;
}

/** A short hex value (8 … 4) with the full value on hover and a copy icon. */
function Hex({ value, "aria-label": ariaLabel = "Copy data" }: TxTreeHexProps) {
  return (
    <span className="tds-txtree__hex" title={value}>
      {shortHex(value)}
      <CopyButton value={value} icon aria-label={ariaLabel} />
    </span>
  );
}

export interface TxTreeAccountProps {
  index: number | string;
  name: React.ReactNode;
  address: string;
  /** Role chips, e.g. ["signer", "writable"]. */
  roles?: React.ReactNode[];
}

/** An account row: `[i]`, name over address (with copy), role chips. */
function Account({ index, name, address, roles = [] }: TxTreeAccountProps) {
  return (
    <div className="tds-txtree__account">
      <span className="tds-txtree__dim">[{index}]</span>
      <div className="tds-txtree__account-main">
        <span className="tds-txtree__account-name">{name}</span>
        <Address value={address} leading={8} trailing={6} className="tds-txtree__account-addr" />
      </div>
      {roles.length > 0 && (
        <div className="tds-txtree__roles">
          {roles.map((role, i) => (
            <span key={i} className="tds-txtree__role">
              {role}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export interface TxTreePreProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Preformatted decoded data in a box that scrolls sideways (never wraps):
 * the thin scrollbar is the affordance for wide rows.
 */
function Pre({ children, className }: TxTreePreProps) {
  return (
    <div className={cn("tds-txtree__prebox", className)}>
      <pre className="tds-txtree__pre">{children}</pre>
    </div>
  );
}

export interface TxTreeBytesProps {
  /** Hex payload, `0x`-prefixed. */
  hex: string;
  copyLabel?: React.ReactNode;
}

/** Wrapped raw bytes (capped height, scrolls) with a copy affordance. */
function Bytes({ hex, copyLabel = "Copy raw bytes" }: TxTreeBytesProps) {
  return (
    <div className="tds-txtree__bytes">
      <div className="tds-txtree__bytes-hex">{hex}</div>
      <CopyButton value={hex} text label={copyLabel} />
    </div>
  );
}

/* ── Root ─────────────────────────────────────────────────────────── */
export interface TxTreeProps {
  children: React.ReactNode;
  className?: string;
}

function Root({ children, className }: TxTreeProps) {
  return (
    <DepthContext.Provider value={0}>
      <div className={cn("tds-txtree", className)}>{children}</div>
    </DepthContext.Provider>
  );
}

/**
 * TxTree — the nested, collapsible review tree of a transaction approval
 * (parameters, accounts, instruction data with its calls and decoded
 * fields, raw bytes). Presentational: the host supplies the decoded data.
 *
 *   <TxTree>
 *     <TxTree.Section label="Parameters" meta="7 fields">
 *       <TxTree.Rows><TxTree.Row label="nonce" value="14" /></TxTree.Rows>
 *     </TxTree.Section>
 *     <TxTree.Section label="Instruction data · MulticallArgs" meta="3 calls" defaultOpen>
 *       <TxTree.Section prefix="[1]" label="router::swap" meta="64 B">
 *         <TxTree.Rows>
 *           <TxTree.Row label="data" value={<TxTree.Hex value="0x…" />} />
 *         </TxTree.Rows>
 *         <TxTree.Section variant="bare" label="decoded" meta="5 fields">
 *           <TxTree.Pre>{decodedText}</TxTree.Pre>
 *         </TxTree.Section>
 *       </TxTree.Section>
 *     </TxTree.Section>
 *   </TxTree>
 */
export const TxTree = Object.assign(Root, {
  Section,
  Rows,
  Row,
  Hex,
  Account,
  Pre,
  Bytes,
});

export const TreeSection = Section;
