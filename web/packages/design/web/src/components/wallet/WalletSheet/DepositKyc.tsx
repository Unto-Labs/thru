import * as React from "react";
import { Input, type InputProps } from "../../Input/Input";
import { Button } from "../../Button/Button";
import { Field } from "../../Field/Field";
import { PasskeyIcon } from "../../PasskeyIcon/PasskeyIcon";
import { Spinner } from "../../Spinner/Spinner";
import { Screen } from "../Screen/Screen";
import { CountryPicker } from "../CountryPicker/CountryPicker";
import { UsStatePicker } from "../UsStatePicker/UsStatePicker";
import type { UsStateCode, UsStateBlocks } from "../UsStatePicker/usStates";
import { IdentityNumberInput } from "../IdentityNumberInput/IdentityNumberInput";
import { DobInput } from "../DobInput/DobInput";
import { StepHeader, type DepositStepProgress } from "./DepositScreens";
import "./DepositScreens.css";

interface UsDepositKycValues {
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

export const depositKycIdLabels = {
  PASSPORT: "Passport",
  NATIONAL_ID: "National ID",
  VOTER_ID: "Voter ID",
  RESIDENT_ID: "Resident ID",
  DRIVER_LICENSE: "Driver’s license",
  NIN: "NIN",
  GHANA_CARD_NUMBER: "Ghana Card",
  SSNIT: "SSNIT card",
  COLOMBIA_PPT: "PPT",
};

export type DepositKycIdType = keyof typeof depositKycIdLabels;

const defaultIdTypes: readonly DepositKycIdType[] = [
  "PASSPORT",
  "NATIONAL_ID",
  "VOTER_ID",
  "RESIDENT_ID",
  "DRIVER_LICENSE",
];

export interface DepositKycValues extends UsDepositKycValues {
  country?: string;
  region?: string;
  postcode?: string;
  idType?: DepositKycIdType | null;
  idNumber?: string;
}

export type WalletSheetDepositKycSection = "details" | "address" | "identity";

const sectionTitles = {
  details: "Your details",
  address: "Home address",
  identity: "Your identity",
};

interface DepositKycProps<Values> {
  section?: WalletSheetDepositKycSection;
  title?: React.ReactNode;
  description?: React.ReactNode;
  step?: DepositStepProgress;
  values: Values;
  onFieldChange: <K extends keyof Values>(field: K, value: Values[K]) => void;
  errors?: Partial<Record<keyof Values, string>>;
  blockedStates?: UsStateBlocks;
  disabled?: boolean;
  submitLabel?: React.ReactNode;
  identitySubmit?: "verify" | "continue";
  submitting?: boolean;
  status?: React.ReactNode;
  notice?: React.ReactNode;
  errorAttempt?: number;
  onSubmit: () => void;
}

type UsDepositKycProps = DepositKycProps<UsDepositKycValues> & {
  countries?: never;
};

export type WalletSheetInternationalDepositKycProps =
  DepositKycProps<DepositKycValues> & {
    countries: readonly string[];
    idTypes?: readonly DepositKycIdType[];
    idNumber?: {
      label?: string;
      placeholder?: string;
      inputMode?: "numeric" | "text";
    };
  };

export type WalletSheetDepositKycProps =
  UsDepositKycProps | WalletSheetInternationalDepositKycProps;

export function DepositKyc(props: WalletSheetDepositKycProps) {
  const { countries } = props;
  const international = countries !== undefined;
  const values: DepositKycValues = props.values;
  const country = international ? (values.country ?? "US") : "US";
  const nonUs = country !== "US";
  const idTypes = (international ? props.idTypes : undefined) ?? defaultIdTypes;
  const idNumber = international ? props.idNumber : undefined;
  const {
    section,
    step = { count: 3, active: 1 },
    blockedStates,
    disabled,
    identitySubmit = nonUs ? "continue" : "verify",
    submitting,
    status,
    notice,
    errorAttempt = 0,
    onSubmit,
  } = props;
  const showDetails = !section || section === "details";
  const showAddress = !section || section === "address";
  const showIdentity = !section || section === "identity";
  const verify = showIdentity && identitySubmit === "verify";
  const {
    title = sectionTitles[section ?? "details"],
    description = !international && showDetails
      ? "US residents only for now."
      : undefined,
    submitLabel = verify ? "Verify with passkey" : "Continue",
  } = props;
  const errors: Partial<Record<keyof DepositKycValues, string>> =
    props.errors ?? {};
  // The US-only form renders only fields supported by its handler.
  const setField =
    props.onFieldChange as WalletSheetInternationalDepositKycProps["onFieldChange"];
  const idTypeLabel = values.idType && depositKycIdLabels[values.idType];
  const countryNoteId = React.useId();
  const formRef = React.useRef<HTMLFormElement>(null);
  React.useEffect(() => {
    if (errorAttempt)
      formRef.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.focus();
  }, [errorAttempt]);

  const input = (
    field: Exclude<
      keyof DepositKycValues,
      "country" | "state" | "ssn" | "dob" | "idType" | "idNumber"
    >,
    props: InputProps,
  ) => (
    <Input
      size="lg"
      text="body"
      {...props}
      value={values[field] ?? ""}
      onChange={(event) => setField(field, event.currentTarget.value)}
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
        {showDetails && (
          <div className="tds-dep__kyc-group">
            {international && (
              <div
                role="group"
                aria-describedby={nonUs ? countryNoteId : undefined}
              >
                <CountryPicker
                  countries={countries}
                  value={country}
                  label="Country"
                  onValueChange={(value) => setField("country", value)}
                  error={errors.country}
                  disabled={disabled}
                />
                {nonUs && (
                  <p
                    id={countryNoteId}
                    className="tds-field__desc tds-dep__kyc-country-note"
                  >
                    Deposits need a US bank for now.
                  </p>
                )}
              </div>
            )}
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
            <div
              className={`tds-dep__kyc-grid tds-dep__kyc-contact${nonUs ? " tds-dep__kyc-contact--international" : ""}`}
            >
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
                autoComplete: nonUs ? "tel" : "tel-national",
              })}
            </div>
          </div>
        )}
        {showAddress && (
          <fieldset className="tds-dep__kyc-address">
            <legend
              className={`tds-field__label${section ? " tds-dep__kyc-legend--hidden" : ""}`}
            >
              Home address
            </legend>
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
              {nonUs ? (
                input("region", {
                  label: "Region",
                  placeholder: "Optional",
                  maxLength: 100,
                  autoComplete: "address-level1",
                })
              ) : (
                <UsStatePicker
                  label="State"
                  value={values.state}
                  onValueChange={(value) => setField("state", value)}
                  blocked={blockedStates}
                  error={errors.state}
                  disabled={disabled}
                />
              )}
              {input(nonUs ? "postcode" : "zip", {
                label: nonUs ? "Postcode" : "ZIP",
                text: "ui",
                inputMode: nonUs ? undefined : "numeric",
                maxLength: nonUs ? 100 : 10,
                autoComplete: "postal-code",
              })}
            </div>
          </fieldset>
        )}
        {showIdentity && (
          <div className="tds-dep__kyc-group">
            {!nonUs ? (
              <IdentityNumberInput
                kind="ssn"
                label="SSN"
                value={values.ssn}
                onValueChange={(value) => setField("ssn", value)}
                error={errors.ssn}
                disabled={disabled}
              />
            ) : (
              <>
                <Field.Root
                  className="tds-dep__kyc-id-type"
                  invalid={!!errors.idType}
                  disabled={disabled}
                >
                  <Field.Label>ID type</Field.Label>
                  <Field.Control
                    render={
                      <select>
                        <option value="" disabled>
                          Select…
                        </option>
                        {idTypes.map((type) => (
                          <option key={type} value={type}>
                            {depositKycIdLabels[type]}
                          </option>
                        ))}
                      </select>
                    }
                    value={values.idType ?? ""}
                    onValueChange={(value) => {
                      const type = idTypes.find((type) => type === value);
                      if (type) setField("idType", type);
                    }}
                  />
                  {errors.idType && (
                    <Field.Error match>{errors.idType}</Field.Error>
                  )}
                </Field.Root>
                <IdentityNumberInput
                  kind="id"
                  {...idNumber}
                  label={
                    idNumber?.label ??
                    (values.idType === "PASSPORT"
                      ? "Passport number"
                      : (idTypeLabel ?? "ID number"))
                  }
                  value={values.idNumber ?? ""}
                  onValueChange={(value) => setField("idNumber", value)}
                  error={errors.idNumber}
                  disabled={disabled}
                />
              </>
            )}
            <DobInput
              label="Date of birth"
              value={values.dob}
              onValueChange={(value) => setField("dob", value)}
              error={errors.dob}
              disabled={disabled}
            />
          </div>
        )}
        <div className="tds-dep__kyc-footer">
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
            {submitting ? (
              <Spinner tone="inherit" />
            ) : verify ? (
              <PasskeyIcon />
            ) : null}
            {submitLabel}
          </Button>
        </div>
      </form>
    </Screen>
  );
}
