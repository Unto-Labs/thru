import * as React from "react";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Radio } from "@base-ui/react/radio";
import { cn } from "../../../utils";
import "./PresetsInput.css";

const Pencil = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <path d="M10.5 2.7l2.8 2.8-7 7-3.3.5.5-3.3 7-7z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>
);
const X = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden {...p}>
    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

export interface PresetOption {
  label: string;
  value: string;
}

export interface PresetsInputProps {
  /** Selectable preset tiles. */
  presets: PresetOption[];
  /** Controlled value. */
  value?: string;
  /** Uncontrolled initial value; defaults to the first preset. */
  defaultValue?: string;
  /** Change handler (fires for both presets and free text). */
  onValueChange?: (value: string) => void;
  /** Optional max hint shown in the custom input. */
  max?: string;
  className?: string;
}

/**
 * PresetsInput — preset value tiles that flip into a free-text input via the
 * pencil toggle. Selection state is driven by Base UI's Radio `data-checked`
 * attribute (styled in CSS). Controlled or uncontrolled.
 */
export const PresetsInput = React.forwardRef<HTMLDivElement, PresetsInputProps>(
  function PresetsInput(
    { presets, value, defaultValue, onValueChange, max, className },
    ref,
  ) {
    const [mode, setMode] = React.useState<"preset" | "custom">("preset");
    const [internal, setInternal] = React.useState(defaultValue ?? presets[0]?.value ?? "");
    const current = value ?? internal;
    const setValue = (v: string) => {
      if (value === undefined) setInternal(v);
      onValueChange?.(v);
    };

    return (
      <div ref={ref} className={cn("tds-presets", className)}>
        {mode === "preset" ? (
          <RadioGroup
            value={current}
            onValueChange={(v) => setValue(v as string)}
            className="tds-presets__grid"
          >
            {presets.map((p) => (
              <Radio.Root key={p.value} value={p.value} className="tds-presets__tile">
                {p.label}
              </Radio.Root>
            ))}
          </RadioGroup>
        ) : (
          <div className="tds-presets__custom">
            <input
              autoFocus
              className="tds-presets__input"
              value={current}
              onChange={(e) => setValue(e.target.value)}
              placeholder="$0"
            />
            {max && <span className="tds-presets__max">{max}</span>}
          </div>
        )}
        <button
          type="button"
          className="tds-presets__toggle"
          aria-label="Toggle custom"
          onClick={() => setMode((m) => (m === "preset" ? "custom" : "preset"))}
        >
          {mode === "preset" ? <Pencil width={14} height={14} /> : <X width={14} height={14} />}
        </button>
      </div>
    );
  },
);
