import * as React from "react";
import { cn } from "../../../utils";
import "./Deposit.css";

const Copy = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
    <path d="M3.5 10.5A1.5 1.5 0 0 1 2.5 9V3.7c0-.66.54-1.2 1.2-1.2H9a1.5 1.5 0 0 1 1.5 1.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);
const Check = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <path d="M3 8.5l3.5 3.5L13 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/* deterministic faux-QR — a 7×7 module grid with finder squares in three
   corners. No encoder; purely decorative. */
function qrCells(seed: number): boolean[] {
  const cells: boolean[] = [];
  let s = seed;
  for (let i = 0; i < 49; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    cells.push((s >> 16) % 2 === 0);
  }
  return cells;
}
function isFinderModule(r: number, c: number): boolean {
  const inFinder = (r < 3 && c < 3) || (r < 3 && c > 3) || (r > 3 && c < 3);
  if (!inFinder) return false;
  const lr = r > 3 ? r - 4 : r;
  const lc = c > 3 ? c - 4 : c;
  // ring + center dot of a 3×3 finder
  return lr === 0 || lr === 2 || lc === 0 || lc === 2 || (lr === 1 && lc === 1);
}

function QrGlyph({ seed = 7 }: { seed?: number }) {
  const cells = React.useMemo(() => qrCells(seed), [seed]);
  return (
    <span className="tds-deposit__qr" aria-hidden>
      {Array.from({ length: 49 }).map((_, i) => {
        const r = Math.floor(i / 7);
        const c = i % 7;
        const inFinderZone = (r < 3 && c < 3) || (r < 3 && c > 3) || (r > 3 && c < 3);
        const on = inFinderZone ? isFinderModule(r, c) : cells[i];
        return (
          <span key={i} className={cn("tds-deposit__qr-cell", on && "tds-deposit__qr-cell--on")} />
        );
      })}
    </span>
  );
}

export interface DepositProps {
  /** Address to display and copy. */
  address: string;
  /** Heading above the address. */
  label?: React.ReactNode;
  /** Seed for the deterministic faux-QR pattern. */
  seed?: number;
  className?: string;
}

/**
 * Deposit — a faux-QR + address row for receiving funds, with a copy button.
 * The QR is a deterministic decorative grid (no encoder). Presentational.
 */
export const Deposit = React.forwardRef<HTMLDivElement, DepositProps>(
  function Deposit({ address, label = "Deposit crypto", seed, className }, ref) {
    const [copied, setCopied] = React.useState(false);
    const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    React.useEffect(
      () => () => {
        if (timerRef.current != null) clearTimeout(timerRef.current);
      },
      [],
    );
    const onCopy = React.useCallback(() => {
      navigator.clipboard?.writeText(address).catch(() => {});
      if (timerRef.current != null) clearTimeout(timerRef.current);
      setCopied(true);
      timerRef.current = setTimeout(() => setCopied(false), 800);
    }, [address]);
    return (
      <div ref={ref} className={cn("tds-deposit", className)}>
        <QrGlyph seed={seed} />
        <div className="tds-deposit__info">
          <div className="tds-deposit__label">{label}</div>
          <div className="tds-deposit__addr">{address}</div>
        </div>
        <button type="button" className="tds-deposit__copy" onClick={onCopy} aria-label="Copy address">
          {copied ? <Check width={14} height={14} /> : <Copy width={14} height={14} />}
        </button>
      </div>
    );
  },
);
