import * as React from "react";
import { RadioGroup as BaseGroup } from "@base-ui/react/radio-group";
import { Radio } from "@base-ui/react/radio";
import "./RadioGroup.css";

export interface RadioOption {
  label: React.ReactNode;
  value: string;
  disabled?: boolean;
}

export interface RadioGroupProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  options: RadioOption[];
  disabled?: boolean;
  name?: string;
  className?: string;
}

/**
 * RadioGroup — one choice from a set. Closed, data-driven wrapper over Base UI's
 * RadioGroup + Radio parts.
 *
 * The selected dot scales in via a CSS transform keyed on the circle's
 * [data-checked] state; nothing is computed in JS.
 */
export const RadioGroup = React.forwardRef<HTMLDivElement, RadioGroupProps>(
  function RadioGroup(
    { value, defaultValue, onValueChange, options, disabled, name, className },
    ref,
  ) {
    return (
      <BaseGroup
        ref={ref}
        value={value}
        defaultValue={defaultValue}
        onValueChange={(v) => onValueChange?.(v as string)}
        disabled={disabled}
        name={name}
        className={["tds-radio-row", className].filter(Boolean).join(" ")}
      >
        {options.map((o) => (
          <label className="tds-radio" key={o.value}>
            <Radio.Root value={o.value} disabled={o.disabled} className="tds-radio__circle">
              <span className="tds-radio__dot" />
            </Radio.Root>
            <span className="tds-radio__label">{o.label}</span>
          </label>
        ))}
      </BaseGroup>
    );
  },
);
