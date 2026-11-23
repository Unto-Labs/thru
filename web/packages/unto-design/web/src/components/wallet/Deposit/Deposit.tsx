import * as React from "react";
import { cn } from "../../../utils";
import { CopyButton } from "../CopyButton/CopyButton";
import "./Deposit.css";

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
  return lr === 0 || lr === 2 || lc === 0 || lc === 2 || (lr === 1 && lc === 1);
}

function QrGlyph({ seed = 7 }: { seed?: number }) {
  const cells = React.useMemo(() => qrCells(seed), [seed]);
  return (
    <span className="uds-deposit__qr" aria-hidden>
      {Array.from({ length: 49 }).map((_, i) => {
        const r = Math.floor(i / 7);
        const c = i % 7;
        const inFinderZone = (r < 3 && c < 3) || (r < 3 && c > 3) || (r > 3 && c < 3);
        const on = inFinderZone ? isFinderModule(r, c) : cells[i];
        return (
          <span key={i} className={cn("uds-deposit__qr-cell", on && "uds-deposit__qr-cell--on")} />
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
 * The QR is a deterministic decorative grid (no encoder).
 */
export const Deposit = React.forwardRef<HTMLDivElement, DepositProps>(
  function Deposit({ address, label = "Deposit crypto", seed, className }, ref) {
    return (
      <div ref={ref} className={cn("uds-deposit", className)}>
        <QrGlyph seed={seed} />
        <div className="uds-deposit__info">
          <div className="uds-deposit__label">{label}</div>
          <div className="uds-deposit__addr">{address}</div>
        </div>
        <CopyButton value={address} variant="icon" aria-label="Copy address" className="uds-deposit__copy" />
      </div>
    );
  },
);
