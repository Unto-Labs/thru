import {
  THRUSD_DOLLAR_PATH,
  THRUSD_STEM_PATH,
  THRUSD_WINGS_PATH,
  THRUSD_RED,
} from "../../tokens/src/thrusd";

export interface ThruUsdLogoProps {
  size?: number;
  label?: string;
}

/** White currency mark on the fixed Thru red disc, in either theme. */
export function ThruUsdLogo({ size = 24, label }: ThruUsdLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ display: "block" }}
    >
      <circle cx="64" cy="64" r="64" fill={THRUSD_RED} />
      <g
        transform="translate(0 4)"
        fill="none"
        stroke="#fff"
        strokeLinecap="square"
        strokeLinejoin="miter"
      >
        <g transform="translate(22.4 22.4) scale(.65)">
          <path d={THRUSD_DOLLAR_PATH} strokeWidth={10} />
          <path d={THRUSD_STEM_PATH} strokeWidth={6} />
        </g>
        <path d={THRUSD_WINGS_PATH} strokeWidth={6} />
      </g>
    </svg>
  );
}
