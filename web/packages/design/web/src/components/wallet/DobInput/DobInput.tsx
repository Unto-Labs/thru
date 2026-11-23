import * as React from "react";
import { Field } from "../../Field/Field";
import { Fieldset } from "../../Fieldset/Fieldset";
import { Input } from "../../Input/Input";
import { cn } from "../../../utils";
import "./DobInput.css";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const noAutofill = {
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
  "data-1p-ignore": true,
  "data-lpignore": "true",
  "data-form-type": "other",
} as const;

export interface DobInputProps {
  /** Month, day and year joined by "/", any part empty while unfilled; "" when all are empty. */
  value: string;
  onValueChange: (text: string) => void;
  label: string;
  error?: string;
  disabled?: boolean;
  className?: string;
}

export function DobInput({
  value,
  onValueChange,
  label,
  error,
  disabled,
  className,
}: DobInputProps) {
  const errorId = React.useId();
  const [month = "", day = "", year = ""] = value.split("/");
  const set = (index: number, part: string) => {
    const parts = [month, day, year];
    parts[index] = part;
    onValueChange(parts.some(Boolean) ? parts.join("/") : "");
  };
  const invalid = !!error;
  const describedBy = invalid ? errorId : undefined;
  const digits =
    (index: number, max: number) =>
    (event: React.ChangeEvent<HTMLInputElement>) =>
      set(index, event.currentTarget.value.replace(/\D/g, "").slice(0, max));

  return (
    <Fieldset.Root className={cn("tds-dob", className)} disabled={disabled}>
      <Fieldset.Legend>{label}</Fieldset.Legend>
      <div className="tds-dob__row">
        <Field.Root className="tds-dob__month" invalid={invalid}>
          <Field.Control
            render={
              <select>
                <option value="" disabled>
                  Month
                </option>
                {MONTHS.map((name, index) => (
                  <option key={name} value={String(index + 1)}>
                    {name}
                  </option>
                ))}
              </select>
            }
            aria-label="Month"
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            autoComplete="off"
            value={/^\d+$/.test(month) ? String(Number(month)) : ""}
            onValueChange={(next) => set(0, String(next))}
          />
        </Field.Root>
        <Input
          {...noAutofill}
          size="lg"
          type="text"
          inputMode="numeric"
          maxLength={2}
          placeholder="Day"
          aria-label="Day"
          className="tds-dob__digits"
          value={day}
          onChange={digits(1, 2)}
          error={invalid}
          aria-describedby={describedBy}
        />
        <Input
          {...noAutofill}
          size="lg"
          type="text"
          inputMode="numeric"
          maxLength={4}
          placeholder="Year"
          aria-label="Year"
          className="tds-dob__digits"
          value={year}
          onChange={digits(2, 4)}
          error={invalid}
          aria-describedby={describedBy}
        />
      </div>
      {error && (
        <p id={errorId} className="tds-field__error">
          {error}
        </p>
      )}
    </Fieldset.Root>
  );
}
