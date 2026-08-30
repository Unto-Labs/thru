import * as React from "react";
import { cn } from "../../utils";
import { styledDiv } from "../../lib/styled";
import "./Sheet.css";

/**
 * Sheet — bottom-sheet chrome, exposed as styled parts (compose freely).
 *
 * Presentational only: it draws the panel, not the presentation. On web,
 * wrap it in `Sheet.Scrim`; inside a native host sheet, render `Sheet.Root`
 * with `size="full"` and let the OS own the scrim and the drag. Keeping that
 * out of the component is what lets one anatomy serve both.
 *
 *     <Sheet.Scrim>
 *       <Sheet.Root size="half">
 *         <Sheet.Grabber />
 *         <Sheet.Header
 *           back={<Sheet.Control label="Back" onClick={prev}>‹</Sheet.Control>}
 *           close={<Sheet.Control label="Close" onClick={onClose}>✕</Sheet.Control>}
 *         >
 *           <Stepper count={3} active={step} />
 *         </Sheet.Header>
 *         <Sheet.Body>
 *           <Sheet.Title>Buy crypto</Sheet.Title>
 *           <Sheet.Lead>Sign in with your phone number to continue.</Sheet.Lead>
 *         </Sheet.Body>
 *         <Sheet.Footer>
 *           <Button>Continue</Button>
 *           <Sheet.Caption>Standard SMS rates may apply.</Sheet.Caption>
 *         </Sheet.Footer>
 *       </Sheet.Root>
 *     </Sheet.Scrim>
 */

export interface SheetRootProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * `half` caps the panel at 50% of its container — the embedded default,
   * so the host app stays visible behind it. `full` fills the container,
   * for when a native host sheet already sized the viewport.
   */
  size?: "half" | "full";
}

const SheetRoot = React.forwardRef<HTMLDivElement, SheetRootProps>(function SheetRoot(
  { size = "half", className, ...rest },
  ref,
) {
  return <div ref={ref} className={cn("tds-sheet", `tds-sheet--${size}`, className)} {...rest} />;
});

export interface SheetHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Leading slot — a `Sheet.Control`, or nothing on the first step. */
  back?: React.ReactNode;
  /** Trailing slot — usually the close `Sheet.Control`. */
  close?: React.ReactNode;
  /** Centred content, typically a `Stepper`. */
  children?: React.ReactNode;
}

/* Both slots render whether or not they hold a control, so the centred
   child does not shift between steps. */
const SheetHeader = React.forwardRef<HTMLDivElement, SheetHeaderProps>(function SheetHeader(
  { back, close, children, className, ...rest },
  ref,
) {
  return (
    <div ref={ref} className={cn("tds-sheet__header", className)} {...rest}>
      <span className="tds-sheet__slot">{back}</span>
      <span className="tds-sheet__center">{children}</span>
      <span className="tds-sheet__slot">{close}</span>
    </div>
  );
});

export interface SheetControlProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name — the glyph child is decorative. */
  label: string;
}

const SheetControl = React.forwardRef<HTMLButtonElement, SheetControlProps>(function SheetControl(
  { label, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className={cn("tds-sheet__control", className)}
      {...rest}
    >
      <span aria-hidden>{children}</span>
    </button>
  );
});

const SheetGrabber = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function SheetGrabber({ className, ...rest }, ref) {
    return <div ref={ref} aria-hidden className={cn("tds-sheet__grabber", className)} {...rest} />;
  },
);

export const Sheet = {
  Scrim: styledDiv("tds-sheet-scrim"),
  Root: SheetRoot,
  Grabber: SheetGrabber,
  Header: SheetHeader,
  Control: SheetControl,
  Body: styledDiv("tds-sheet__body"),
  Title: styledDiv("tds-sheet__title"),
  Lead: styledDiv("tds-sheet__lead"),
  Footer: styledDiv("tds-sheet__footer"),
  Caption: styledDiv("tds-sheet__caption"),
};
