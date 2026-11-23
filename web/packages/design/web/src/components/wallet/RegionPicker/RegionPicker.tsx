import * as React from "react";
import { Field } from "@base-ui/react/field";
import { Combobox } from "../../Combobox/Combobox";
import { cn } from "../../../utils";
import { regionOptionLabel, type RegionOption } from "./regionOptions";
import "../../Field/Field.css";
import "../UsStatePicker/UsStatePicker.css";

interface RegionPickerProps<Code extends string> {
  region: "state" | "country";
  options: readonly RegionOption<Code>[];
  matches: (option: RegionOption<Code>, query: string) => boolean;
  value: Code | null;
  onValueChange: (code: Code) => void;
  label: string;
  error?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function RegionPicker<Code extends string>({
  region,
  options,
  matches,
  value,
  onValueChange,
  label,
  error,
  disabled,
  id,
  className,
}: RegionPickerProps<Code>) {
  const isState = region === "state";
  const regionPlural = isState ? "states" : "countries";
  const searchLabel = `Search ${regionPlural}`;
  const selected = options.find((option) => option.code === value) ?? null;
  const errorId = React.useId();
  const labelId = React.useId();
  // Portal into the caller's skin scope so the popup keeps its theme and custom properties.
  const [portalContainer, setPortalContainer] =
    React.useState<HTMLElement | null>(null);
  const [collisionBoundary, setCollisionBoundary] =
    React.useState<Element | null>(null);
  const triggerRef = React.useCallback((node: HTMLButtonElement | null) => {
    setPortalContainer(
      node?.closest<HTMLElement>("body [data-tds-skin]") ?? null,
    );
    setCollisionBoundary(node?.closest(".tds-frame") ?? null);
  }, []);

  return (
    <Field.Root
      disabled={disabled}
      className={cn("tds-field tds-state-picker", className)}
    >
      <Field.Label
        id={labelId}
        nativeLabel={false}
        render={<div />}
        className="tds-field__label"
      >
        {label}
      </Field.Label>
      <Combobox.Root
        id={id}
        items={options}
        value={selected}
        onValueChange={(option) => {
          if (option && option.blockedReason === undefined)
            onValueChange(option.code);
        }}
        itemToStringLabel={(option) => (isState ? option.code : option.name)}
        filter={matches}
      >
        <Combobox.Trigger
          ref={triggerRef}
          id={id}
          aria-labelledby={labelId}
          className="tds-state-picker__trigger"
          data-error={!!error || undefined}
          aria-invalid={!!error || undefined}
          aria-describedby={error ? errorId : undefined}
          onKeyDown={(event) => {
            // Closed-trigger typeahead commits partial matches; search belongs in the popup.
            if (event.key.length === 1 && event.key !== " ")
              event.preventBaseUIHandler();
          }}
        >
          {isState ? (
            <Combobox.Value>{selected?.code ?? ""}</Combobox.Value>
          ) : (
            <span className="tds-country-picker__value">
              <Combobox.Value />
            </span>
          )}
          <Combobox.Icon className="tds-state-picker__icon">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <path
                d="m6 9 6 6 6-6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Combobox.Icon>
        </Combobox.Trigger>
        <Combobox.Portal container={portalContainer ?? undefined}>
          <Combobox.Positioner
            className="tds-state-picker__positioner"
            sideOffset={4}
            align="start"
            collisionBoundary={collisionBoundary ?? undefined}
            collisionPadding={16}
            collisionAvoidance={{ align: "shift", fallbackAxisSide: "none" }}
          >
            <Combobox.Popup
              className="tds-state-picker__popup"
              aria-label={label}
            >
              <div className="tds-state-picker__search-wrap">
                <Combobox.Input
                  className="tds-state-picker__search"
                  aria-label={searchLabel}
                  placeholder={searchLabel}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  data-1p-ignore
                  data-lpignore="true"
                  data-form-type="other"
                />
              </div>
              <Combobox.Empty className="tds-state-picker__empty">
                No matching {regionPlural}
              </Combobox.Empty>
              <Combobox.List className="tds-state-picker__list">
                {(option) => (
                  <Combobox.Item
                    key={option.code}
                    value={option}
                    disabled={option.blockedReason !== undefined}
                    aria-label={regionOptionLabel(option)}
                    className="tds-state-picker__option"
                  >
                    <Combobox.ItemIndicator>
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 16 16"
                        fill="none"
                        aria-hidden
                      >
                        <path
                          d="m3 8 3 3 7-7"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </Combobox.ItemIndicator>
                    <span className="tds-state-picker__code" aria-hidden>
                      {option.code}
                    </span>
                    <span className="tds-state-picker__text">
                      <span>{option.name}</span>
                      {option.blockedReason !== undefined && (
                        <span className="tds-state-picker__reason">
                          {option.blockedReason}
                        </span>
                      )}
                    </span>
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
      {error && (
        <Field.Error match id={errorId} className="tds-field__error">
          {error}
        </Field.Error>
      )}
    </Field.Root>
  );
}
