import {
  UNTOUSD_DOLLAR_PATH,
  UNTOUSD_STEM_PATH,
  UNTOUSD_WINGS_PATH,
  UNTOUSD_RED,
} from "../../tokens/src/untousd";

export interface UntoUsdLogoProps {
  size?: number;
  label?: string;
}

/** White currency mark on the fixed Unto red disc, in either theme. */
export function UntoUsdLogo({ size = 24, label }: UntoUsdLogoProps) {
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
      <circle cx="64" cy="64" r="64" fill={UNTOUSD_RED} />
      <g
        transform="translate(0 4)"
        fill="none"
        stroke="#fff"
        strokeLinecap="square"
        strokeLinejoin="miter"
      >
        <g transform="translate(22.4 22.4) scale(.65)">
          <path d={UNTOUSD_DOLLAR_PATH} strokeWidth={10} />
          <path d={UNTOUSD_STEM_PATH} strokeWidth={6} />
        </g>
        <path d={UNTOUSD_WINGS_PATH} strokeWidth={6} />
      </g>
    </svg>
  );
}
