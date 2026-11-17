import { UUSD_PLACEHOLDER_COLOR } from "../../tokens/src/uusd";

export interface UusdLogoProps {
  size?: number;
  label?: string;
}

/** Generic "$" disc standing in for the Unto dollar's logo. */
export function UusdLogo({ size = 24, label }: UusdLogoProps) {
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
      <circle cx="64" cy="64" r="64" fill={UUSD_PLACEHOLDER_COLOR} />
      <text
        x="64"
        y="66"
        fill="#fff"
        fontFamily="system-ui, sans-serif"
        fontSize="72"
        fontWeight="700"
        textAnchor="middle"
        dominantBaseline="central"
      >
        $
      </text>
    </svg>
  );
}
