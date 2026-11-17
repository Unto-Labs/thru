import * as React from "react";
import { Input, type InputProps } from "../../Input/Input";
import { Button } from "../../Button/Button";
import { PasskeyIcon } from "../../PasskeyIcon/PasskeyIcon";
import { Spinner } from "../../Spinner/Spinner";
import { Screen } from "../Screen/Screen";
import { UsStatePicker } from "../UsStatePicker/UsStatePicker";
import type { UsStateCode, UsStateBlocks } from "../UsStatePicker/usStates";
import { IdentityNumberInput } from "../IdentityNumberInput/IdentityNumberInput";
import { DobInput } from "../DobInput/DobInput";
import { Lock, StepHeader, type DepositStepProgress } from "./DepositScreens";
import "./DepositScreens.css";

interface DepositKycValues {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  street: string;
  apartment: string;
  city: string;
  state: UsStateCode | null;
  zip: string;
  ssn: string;
  dob: string;
}

export interface WalletSheetDepositKycProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  step?: DepositStepProgress;
  values: DepositKycValues;
  onFieldChange: <K extends keyof DepositKycValues>(
    field: K,
    value: DepositKycValues[K],
  ) => void;
  errors?: Partial<Record<keyof DepositKycValues, string>>;
  blockedStates?: UsStateBlocks;
  disabled?: boolean;
  submitLabel?: React.ReactNode;
  submitting?: boolean;
  status?: React.ReactNode;
  notice?: React.ReactNode;
  errorAttempt?: number;
  onSubmit: () => void;
}

export function DepositKyc({
  title = "Your details",
  description = "US residents only for now.",
  step = { count: 3, active: 1 },
  values,
  onFieldChange,
  errors = {},
  blockedStates,
  disabled,
  submitLabel = "Verify with passkey",
  submitting,
  status,
  notice,
  errorAttempt = 0,
  onSubmit,
}: WalletSheetDepositKycProps) {
  const formRef = React.useRef<HTMLFormElement>(null);
  React.useEffect(() => {
    if (errorAttempt)
      formRef.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.focus();
  }, [errorAttempt]);

  const input = (
    field: Exclude<keyof DepositKycValues, "state" | "ssn" | "dob">,
    props: InputProps,
  ) => (
    <Input
      size="lg"
      text="body"
      {...props}
      value={values[field]}
      onChange={(event) => onFieldChange(field, event.target.value)}
      errorMessage={errors[field]}
      disabled={disabled}
    />
  );

  return (
    <Screen>
      <StepHeader title={title} description={description} step={step} />
      <form
        ref={formRef}
        noValidate
        className="tds-dep__kyc"
        onSubmit={(event) => {
          event.preventDefault();
          if (!submitting) onSubmit();
        }}
      >
        <div className="tds-dep__kyc-group">
          <div className="tds-dep__kyc-grid">
            {input("firstName", {
              label: "First name",
              maxLength: 100,
              autoComplete: "given-name",
            })}
            {input("lastName", {
              label: "Last name",
              maxLength: 100,
              autoComplete: "family-name",
            })}
          </div>
          <div className="tds-dep__kyc-grid tds-dep__kyc-contact">
            {input("email", {
              label: "Email",
              type: "email",
              maxLength: 254,
              autoComplete: "email",
            })}
            {input("phone", {
              label: "Phone",
              type: "tel",
              text: "ui",
              inputMode: "tel",
              autoComplete: "tel-national",
            })}
          </div>
        </div>
        <fieldset className="tds-dep__kyc-address">
          <legend className="tds-field__label">Home address</legend>
          {input("street", {
            "aria-label": "Street",
            placeholder: "Street",
            maxLength: 200,
            autoComplete: "address-line1",
          })}
          {input("apartment", {
            "aria-label": "Apt, suite (optional)",
            placeholder: "Apt, suite (optional)",
            maxLength: 200,
            autoComplete: "address-line2",
          })}
          <div className="tds-dep__kyc-locality">
            {input("city", {
              label: "City",
              maxLength: 100,
              autoComplete: "address-level2",
            })}
            <UsStatePicker
              label="State"
              value={values.state}
              onValueChange={(value) => onFieldChange("state", value)}
              blocked={blockedStates}
              error={errors.state}
              disabled={disabled}
            />
            {input("zip", {
              label: "ZIP",
              text: "ui",
              inputMode: "numeric",
              maxLength: 10,
              autoComplete: "postal-code",
            })}
          </div>
        </fieldset>
        <div className="tds-dep__kyc-grid tds-dep__kyc-identity">
          <IdentityNumberInput
            kind="ssn"
            label="SSN"
            value={values.ssn}
            onValueChange={(value) => onFieldChange("ssn", value)}
            error={errors.ssn}
            disabled={disabled}
          />
          <DobInput
            label="Date of birth"
            value={values.dob}
            onValueChange={(value) => onFieldChange("dob", value)}
            error={errors.dob}
            disabled={disabled}
          />
        </div>
        <div className="tds-dep__kyc-footer">
          <div className="tds-dep__kyc-note">
            <Lock width={12} height={12} />
            Sent to Brale. Never stored by us.
          </div>
          {(status || notice) && (
            <div className="tds-dep__note" role="status">
              {status || notice}
            </div>
          )}
          <Button
            type="submit"
            variant="primary"
            className="tds-wsheet__cta"
            disabled={submitting}
            aria-busy={submitting || undefined}
          >
            {submitting ? <Spinner tone="inherit" /> : <PasskeyIcon />}
            {submitLabel}
          </Button>
        </div>
      </form>
    </Screen>
  );
}
