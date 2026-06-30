import * as React from "react";
import { Checkbox as Base } from "@base-ui/react/checkbox";
import "./Checkbox.css";

export interface CheckboxProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  indeterminate?: boolean;
  disabled?: boolean;
  name?: string;
  value?: string;
  children?: React.ReactNode;
  className?: string;
}

const Check = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <path
      d="M3 8.5l3.5 3.5L13 4"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * Checkbox — Base UI behavior, token-driven look. Closed wrapper with a label.
 *
 * Boolean + indeterminate states are exposed via Base UI's [data-checked] /
 * [data-indeterminate] / [data-disabled] hooks; all styling lives in CSS.
 */
export const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  function Checkbox(
    {
      checked,
      defaultChecked,
      onCheckedChange,
      indeterminate,
      disabled,
      name,
      value,
      children,
      className,
    },
    ref,
  ) {
    return (
      <label className={["tds-check", className].filter(Boolean).join(" ")}>
        <Base.Root
          ref={ref}
          checked={checked}
          defaultChecked={defaultChecked}
          onCheckedChange={(v) => onCheckedChange?.(Boolean(v))}
          indeterminate={indeterminate}
          disabled={disabled}
          name={name}
          value={value}
          className="tds-check__box"
        >
          <Base.Indicator className="tds-check__indicator" keepMounted>
            {indeterminate ? (
              <span className="tds-check__dash" />
            ) : (
              <Check width={12} height={12} />
            )}
          </Base.Indicator>
        </Base.Root>
        {children != null && <span className="tds-check__label">{children}</span>}
      </label>
    );
  },
);
