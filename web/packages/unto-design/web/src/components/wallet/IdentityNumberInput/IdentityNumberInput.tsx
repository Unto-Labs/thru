import * as React from "react";
import { Button } from "../../Button/Button";
import { Input } from "../../Input/Input";
import { cn } from "../../../utils";
import { applyMaskedEdit } from "../masked-edit";
import { IDENTITY_FORMATS, type IdentityNumberKind } from "./identity";
import "./IdentityNumberInput.css";

export interface IdentityNumberInputProps {
  kind: IdentityNumberKind;
  value: string;
  onValueChange: (raw: string) => void;
  label: string;
  error?: string;
  revealed?: boolean;
  defaultRevealed?: boolean;
  onRevealedChange?: (revealed: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function IdentityNumberInput({
  kind, value, onValueChange, label, error, revealed, defaultRevealed = false,
  onRevealedChange, disabled, id, className,
}: IdentityNumberInputProps) {
  const generatedId = React.useId();
  const inputId = id ?? generatedId;
  const [internal, setInternal] = React.useState(defaultRevealed);
  const visible = revealed ?? internal;
  const fmt = IDENTITY_FORMATS[kind];
  const display = fmt.format(value);

  return (
    <Input
      id={inputId}
      label={label}
      size="lg"
      disabled={disabled}
      className={cn("uds-identity-input", className)}
      value={display}
      onChange={(e) => onValueChange(fmt.normalize(applyMaskedEdit(e, display, fmt.format)))}
      inputMode={fmt.inputMode}
      placeholder={fmt.placeholder}
      errorMessage={error}
      type="text"
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      data-1p-ignore
      data-lpignore="true"
      data-form-type="other"
      data-masked={!visible || undefined}
      trailing={
        <Button
          variant="ghost"
          size="sm"
          type="button"
          className="uds-identity-input__toggle"
          disabled={disabled}
          aria-label={visible ? "Hide number" : "Show number"}
          onClick={() => {
            if (revealed === undefined) setInternal(!visible);
            onRevealedChange?.(!visible);
          }}
        >
          {visible ? "Hide" : "Show"}
        </Button>
      }
    />
  );
}
