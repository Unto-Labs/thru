import * as React from "react";
import { Field } from "@base-ui/react/field";
import { cn } from "../../utils";
import "./Input.css";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
  label?: string;
  wrapperClassName?: string;
}

/**
 * Input — built on Base UI's Field (label association + a11y wiring).
 * API matches the legacy design-system's Input 1:1 (error / label / wrapperClassName),
 * styled with plain CSS against the tokens. Clicking anywhere in the padded
 * wrapper focuses the control, mirroring the old behavior.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input({ className, error, label, id, wrapperClassName, disabled, ...props }, ref) {
    const innerRef = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(ref, () => innerRef.current as HTMLInputElement, []);

    return (
      <Field.Root className="tds-field" disabled={disabled}>
        {label && <Field.Label className="tds-field__label">{label}</Field.Label>}
        <div
          className={cn("tds-input-wrap", wrapperClassName)}
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
            className={cn("tds-input", className)}
            {...props}
          />
        </div>
      </Field.Root>
    );
  },
);
