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
 * Switch — instant on/off. Closed wrapper with a label.
 */
export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  function Switch(
    { checked, defaultChecked, onCheckedChange, disabled, name, value, label, className },
    ref,
  ) {
    return (
      <label className={["uds-switch-field", className].filter(Boolean).join(" ")}>
        <Base.Root
          ref={ref}
          checked={checked}
          defaultChecked={defaultChecked}
          onCheckedChange={(v) => onCheckedChange?.(Boolean(v))}
          disabled={disabled}
          name={name}
          value={value}
          className="uds-switch"
        >
          <Base.Thumb className="uds-switch__thumb" />
        </Base.Root>
        {label != null && <span className="uds-switch__label">{label}</span>}
      </label>
    );
  },
);
