import * as React from "react";
import { Switch as Base } from "@base-ui/react/switch";
import "./Switch.css";

export interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  name?: string;
  value?: string;
  label?: React.ReactNode;
  className?: string;
}

/**
 * Switch — instant on/off, brand-red when active. Closed wrapper with a label.
 *
 * Base UI drives behavior + the [data-checked] / [data-disabled] hooks the CSS
 * styles against. The thumb slides via a CSS transform keyed on [data-checked].
 */
export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  function Switch(
    { checked, defaultChecked, onCheckedChange, disabled, name, value, label, className },
    ref,
  ) {
    return (
      <label className={["tds-switch-field", className].filter(Boolean).join(" ")}>
        <Base.Root
          ref={ref}
          checked={checked}
          defaultChecked={defaultChecked}
          onCheckedChange={(v) => onCheckedChange?.(Boolean(v))}
          disabled={disabled}
          name={name}
          value={value}
          className="tds-switch"
        >
          <Base.Thumb className="tds-switch__thumb" />
        </Base.Root>
        {label != null && <span className="tds-switch__label">{label}</span>}
      </label>
    );
  },
);
