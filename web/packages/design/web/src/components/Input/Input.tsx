import * as React from "react";
import { Field } from "@base-ui/react/field";
import { cn } from "../../utils";
import "./Input.css";

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  error?: boolean;
  label?: string;
  wrapperClassName?: string;
  /**
   * Control height. `md` is the compact desktop default; `lg` is the 48px
   * touch metric for embedded and mobile surfaces (clears the 44px minimum
   * hit target).
   */
  size?: "md" | "lg";
  /**
   * Which half of the type ramp the value belongs to: `ui` is mono, for
   * machine-facing values (addresses, codes, phone numbers); `body` is sans,
   * for prose the user wrote (names, email).
   */
  text?: "ui" | "body";
}

/**
 * Input — built on Base UI's Field (label association + a11y wiring).
 * API matches the legacy design-system's Input 1:1 (error / label / wrapperClassName),
 * styled with plain CSS against the tokens. Clicking anywhere in the padded
 * wrapper focuses the control, mirroring the old behavior.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input(
    {
      className,
      error,
      label,
      id,
      wrapperClassName,
      disabled,
      size = "md",
      text = "ui",
      ...props
    },
    ref,
  ) {
    const innerRef = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(ref, () => innerRef.current as HTMLInputElement, []);

    return (
      <Field.Root className="tds-field" disabled={disabled}>
        {label && <Field.Label className="tds-field__label">{label}</Field.Label>}
        <div
          className={cn("tds-input-wrap", `tds-input-wrap--${size}`, wrapperClassName)}
          data-error={error || undefined}
          onMouseDown={(e) => {
            if (e.target !== innerRef.current) {
              e.preventDefault();
              innerRef.current?.focus();
            }
          }}
        >
          <Field.Control
            ref={innerRef}
            id={id}
            disabled={disabled}
            aria-invalid={error || undefined}
            className={cn("tds-input", `tds-input--${text}`, className)}
            {...props}
          />
        </div>
      </Field.Root>
    );
  },
);
