import { Input } from "../../Input/Input";
import { cn } from "../../../utils";
import { applyMaskedEdit } from "../masked-edit";
import { formatDob } from "./dob";
import "./DobInput.css";

export interface DobInputProps {
  value: string;
  onValueChange: (text: string) => void;
  label: string;
  error?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function DobInput({
  value, onValueChange, label, error, disabled, id, className,
}: DobInputProps) {
  return (
    <Input
      id={id}
      label={label}
      size="lg"
      disabled={disabled}
      className={cn("tds-dob-input", className)}
      value={value}
      onChange={(e) => onValueChange(applyMaskedEdit(e, value, formatDob))}
      type="text"
      inputMode="numeric"
      placeholder="MM / DD / YYYY"
      errorMessage={error}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      data-1p-ignore
      data-lpignore="true"
      data-form-type="other"
    />
  );
}
