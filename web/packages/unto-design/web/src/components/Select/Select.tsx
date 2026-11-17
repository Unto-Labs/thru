import * as React from "react";
import { Select as BaseSelect } from "@base-ui/react/select";
import "./Select.css";

export interface SelectOption {
  label: string;
  value: string;
}

export interface SelectProps {
  value?: string;
  onValueChange?: (value: string) => void;
  items: SelectOption[];
  placeholder?: string;
  size?: "sm" | "md";
  ariaLabel?: string;
  className?: string;
}

const ChevronDown = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const Check = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <path d="M3 8.5l3.5 3.5L13 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function Select({
  value,
  onValueChange,
  items,
  placeholder = "Select…",
  size = "md",
  ariaLabel,
  className = "",
}: SelectProps) {
  return (
    <BaseSelect.Root
      items={items}
      value={value}
      onValueChange={(v) => onValueChange?.(v as string)}
    >
      <BaseSelect.Trigger
        className={["uds-select-trigger", `uds-select-trigger--${size}`, className].filter(Boolean).join(" ")}
        aria-label={ariaLabel}
      >
        <BaseSelect.Value placeholder={placeholder} />
        <BaseSelect.Icon className="uds-select-icon">
          <ChevronDown width={14} height={14} />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        {/* alignItemWithTrigger defaults to true, which overlays the popup on
            the trigger and ignores sideOffset/align. */}
        <BaseSelect.Positioner sideOffset={4} align="start" alignItemWithTrigger={false}>
          <BaseSelect.Popup className="uds-select-popup">
            {items.map((it) => (
              <BaseSelect.Item key={it.value} value={it.value} className="uds-select-item">
                <BaseSelect.ItemIndicator className="uds-select-item-indicator">
                  <Check width={13} height={13} />
                </BaseSelect.ItemIndicator>
                <BaseSelect.ItemText>{it.label}</BaseSelect.ItemText>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
