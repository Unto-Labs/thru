import * as React from "react";
import { Field } from "@base-ui/react/field";
import { cn } from "../../utils";
import "../Field/Field.css";
import "./Input.css";

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  error?: boolean;
  errorMessage?: string;
  trailing?: React.ReactNode;
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
 * Clicking anywhere in the padded wrapper focuses the control.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input(
    {
      className,
      error,
      errorMessage,
      trailing,
      label,
      id,
      wrapperClassName,
      disabled,
      size = "md",
      text = "ui",
      "aria-describedby": describedBy,
      ...props
    },
    ref,
  ) {
    const innerRef = React.useRef<HTMLInputElement>(null);
    const errorId = React.useId();
    React.useImperativeHandle(ref, () => innerRef.current as HTMLInputElement, []);

    return (
      <Field.Root className="uds-field" disabled={disabled}>
        {label && <Field.Label {...(id ? { htmlFor: id } : {})} className="uds-field__label">{label}</Field.Label>}
        <div
          className={cn("uds-input-wrap", `uds-input-wrap--${size}`, wrapperClassName)}
          data-error={error || !!errorMessage || undefined}
          onMouseDown={(e) => {
            if (e.target !== innerRef.current && !(e.target instanceof Element && e.target.closest("button"))) {
              e.preventDefault();
              innerRef.current?.focus();
            }
          }}
        >
          <Field.Control
            ref={innerRef}
            id={id}
            /* Base UI registers explicit IDs after hydration; keep SSR references valid too. */
            render={id ? (controlProps) => <input {...controlProps} id={id} /> : undefined}
            disabled={disabled}
            aria-invalid={error || !!errorMessage || undefined}
            className={cn("uds-input", `uds-input--${text}`, className)}
            aria-describedby={[describedBy, errorMessage && errorId].filter(Boolean).join(" ") || undefined}
            {...props}
          />
          {trailing}
        </div>
        {errorMessage && <Field.Error id={errorId} match className="uds-field__error">{errorMessage}</Field.Error>}
      </Field.Root>
    );
  },
);
