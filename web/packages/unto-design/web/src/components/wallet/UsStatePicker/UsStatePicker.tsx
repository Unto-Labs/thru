import * as React from "react";
import { Field } from "@base-ui/react/field";
import { Combobox } from "../../Combobox/Combobox";
import { cn } from "../../../utils";
import { matchesUsState, usStateOptionLabel, usStateOptions, type UsStateBlocks, type UsStateCode } from "./usStates";
import "../../Field/Field.css";
import "./UsStatePicker.css";

export interface UsStatePickerProps {
  value: UsStateCode | null;
  onValueChange: (code: UsStateCode) => void;
  label: string;
  blocked?: UsStateBlocks;
  error?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function UsStatePicker({
  value, onValueChange, label, blocked, error, disabled, id, className,
}: UsStatePickerProps) {
  const options = React.useMemo(() => usStateOptions(blocked), [blocked]);
  const selected = options.find((option) => option.code === value) ?? null;
  const errorId = React.useId();
  const labelId = React.useId();
  // Portal into the caller's theme scope so the popup keeps its theme and custom properties.
  const [portalContainer, setPortalContainer] = React.useState<HTMLElement | null>(null);
  const [collisionBoundary, setCollisionBoundary] = React.useState<Element | null>(null);
  const triggerRef = React.useCallback((node: HTMLButtonElement | null) => {
    setPortalContainer(node?.closest<HTMLElement>("body [data-theme]") ?? null);
    setCollisionBoundary(node?.closest(".uds-frame") ?? null);
  }, []);

  return (
    <Field.Root disabled={disabled} className={cn("uds-field uds-state-picker", className)}>
      <Field.Label id={labelId} nativeLabel={false} render={<div />} className="uds-field__label">{label}</Field.Label>
      <Combobox.Root
        id={id}
        items={options}
        value={selected}
        onValueChange={(option) => {
          if (option && option.blockedReason === undefined) onValueChange(option.code);
        }}
        itemToStringLabel={(option) => option.code}
        filter={matchesUsState}
      >
        <Combobox.Trigger
          ref={triggerRef}
          id={id}
          aria-labelledby={labelId}
          className="uds-state-picker__trigger"
          data-error={!!error || undefined}
          aria-invalid={!!error || undefined}
          aria-describedby={error ? errorId : undefined}
          onKeyDown={(event) => {
            // Closed-trigger typeahead commits partial matches; search belongs in the popup.
            if (event.key.length === 1 && event.key !== " ") event.preventBaseUIHandler();
          }}
        >
          <Combobox.Value>{selected?.code ?? ""}</Combobox.Value>
          <Combobox.Icon className="uds-state-picker__icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Combobox.Icon>
        </Combobox.Trigger>
        <Combobox.Portal container={portalContainer ?? undefined}>
          <Combobox.Positioner
            className="uds-state-picker__positioner"
            sideOffset={4}
            align="start"
            collisionBoundary={collisionBoundary ?? undefined}
            collisionPadding={16}
            collisionAvoidance={{ align: "shift", fallbackAxisSide: "none" }}
          >
            <Combobox.Popup className="uds-state-picker__popup" aria-label={label}>
              <div className="uds-state-picker__search-wrap">
                <Combobox.Input
                  className="uds-state-picker__search"
                  aria-label="Search states"
                  placeholder="Search states"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  data-1p-ignore
                  data-lpignore="true"
                  data-form-type="other"
                />
              </div>
              <Combobox.Empty className="uds-state-picker__empty">No matching states</Combobox.Empty>
              <Combobox.List className="uds-state-picker__list">
                {(option) => (
                  <Combobox.Item
                    key={option.code}
                    value={option}
                    disabled={option.blockedReason !== undefined}
                    aria-label={usStateOptionLabel(option)}
                    className="uds-state-picker__option"
                  >
                    <Combobox.ItemIndicator>
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                        <path d="m3 8 3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </Combobox.ItemIndicator>
                    <span className="uds-state-picker__code" aria-hidden>{option.code}</span>
                    <span className="uds-state-picker__text">
                      <span>{option.name}</span>
                      {option.blockedReason !== undefined && <span className="uds-state-picker__reason">{option.blockedReason}</span>}
                    </span>
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
      {error && <Field.Error match id={errorId} className="uds-field__error">{error}</Field.Error>}
    </Field.Root>
  );
}
