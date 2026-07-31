/**
 * Stroke icons matching the kit's style: 24-viewBox, 1.5 stroke, square caps.
 * Paths are copied from the imported design; an explicit `color` always wins,
 * otherwise the icon takes its tone from the active theme.
 */
import Svg, { Path, Rect, Circle } from "react-native-svg";
import { useThemeColors } from "./theme";

export interface IconProps {
  size?: number;
  color?: string;
}

type IconTone = "fg" | "muted" | "subtle" | "accent" | "forest";

function base(size: number) {
  return { width: size, height: size, viewBox: "0 0 24 24", fill: "none" } as const;
}

const stroke = (color: string, width = 1.5) =>
  ({ stroke: color, strokeWidth: width, strokeLinecap: "square" }) as const;

function useIconColor(override: string | undefined, tone: IconTone = "fg"): string {
  const colors = useThemeColors();
  if (override) return override;
  switch (tone) {
    case "muted":
      return colors.fgMuted;
    case "subtle":
      return colors.fgSubtle;
    case "accent":
      return colors.accent;
    case "forest":
      return colors.forest;
    default:
      return colors.fg;
  }
}

export function IconHome({ size = 21, color }: IconProps) {
  const c = useIconColor(color);
  return (
    <Svg {...base(size)}>
      <Path d="M3 11 12 3l9 8" {...stroke(c)} />
      <Path d="M5 9.5V21h14V9.5" {...stroke(c)} />
    </Svg>
  );
}

export function IconSwap({ size = 21, color }: IconProps) {
  const c = useIconColor(color);
  return (
    <Svg {...base(size)}>
      <Path d="M4 8h13M14 4l4 4-4 4" {...stroke(c)} />
      <Path d="M20 16H7M10 12l-4 4 4 4" {...stroke(c)} />
    </Svg>
  );
}

export function IconSettings({ size = 21, color }: IconProps) {
  const c = useIconColor(color);
  return (
    <Svg {...base(size)}>
      <Path d="M4 7h10M18 7h2M4 17h2M10 17h10" {...stroke(c)} />
      <Circle cx={16} cy={7} r={2.4} {...stroke(c)} />
      <Circle cx={7} cy={17} r={2.4} {...stroke(c)} />
    </Svg>
  );
}

export function IconActivity({ size = 21, color }: IconProps) {
  const c = useIconColor(color);
  return (
    <Svg {...base(size)}>
      <Path d="M2 12h4l3-8 5 16 3-8h5" {...stroke(c)} />
    </Svg>
  );
}

export function IconCopy({ size = 18, color }: IconProps) {
  const c = useIconColor(color);
  return (
    <Svg {...base(size)}>
      <Rect x={9} y={9} width={11} height={11} {...stroke(c)} />
      <Path d="M5 15V5h10" {...stroke(c)} />
    </Svg>
  );
}

export function IconChevronRight({ size = 18, color }: IconProps) {
  const c = useIconColor(color, "subtle");
  return (
    <Svg {...base(size)}>
      <Path d="m9 5 7 7-7 7" {...stroke(c)} />
    </Svg>
  );
}

export function IconChevronDown({ size = 18, color }: IconProps) {
  const c = useIconColor(color, "subtle");
  return (
    <Svg {...base(size)}>
      <Path d="m6 9 6 6 6-6" {...stroke(c)} />
    </Svg>
  );
}

export function IconChevronLeft({ size = 20, color }: IconProps) {
  const c = useIconColor(color);
  return (
    <Svg {...base(size)}>
      <Path d="m15 6-6 6 6 6" {...stroke(c)} />
    </Svg>
  );
}

export function IconArrowRight({ size = 18, color }: IconProps) {
  const c = useIconColor(color, "subtle");
  return (
    <Svg {...base(size)}>
      <Path d="M4 12h14M14 7l5 5-5 5" {...stroke(c)} />
    </Svg>
  );
}

export function IconClose({ size = 18, color }: IconProps) {
  const c = useIconColor(color);
  return (
    <Svg {...base(size)}>
      <Path d="M6 6l12 12M18 6 6 18" {...stroke(c)} />
    </Svg>
  );
}

export function IconCheck({ size = 18, color }: IconProps) {
  const c = useIconColor(color, "forest");
  return (
    <Svg {...base(size)}>
      <Path d="m5 12.5 5 5L19 7" {...stroke(c)} />
    </Svg>
  );
}

/** The heavier tick the design uses for confirmations and progress rows. */
export function IconCheckBold({ size = 18, color }: IconProps) {
  const c = useIconColor(color, "forest");
  return (
    <Svg {...base(size)}>
      <Path d="M20 6 9 17l-5-5" {...stroke(c, 2)} />
    </Svg>
  );
}

export function IconLink({ size = 18, color }: IconProps) {
  const c = useIconColor(color);
  return (
    <Svg {...base(size)}>
      <Path d="M10 14a4 4 0 0 0 6 .5l3-3a4 4 0 1 0-6-6l-1.5 1.5" {...stroke(c)} />
      <Path d="M14 10a4 4 0 0 0-6-.5l-3 3a4 4 0 1 0 6 6L12.5 17" {...stroke(c)} />
    </Svg>
  );
}

export function IconDeposit({ size = 21, color }: IconProps) {
  const c = useIconColor(color);
  return (
    <Svg {...base(size)}>
      <Path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" {...stroke(c)} />
      <Path d="M4 19h16" {...stroke(c)} />
    </Svg>
  );
}

/** Long down-arrow used on the home Deposit action. */
export function IconArrowDown({ size = 18, color }: IconProps) {
  const c = useIconColor(color);
  return (
    <Svg {...base(size)}>
      <Path d="M12 3v13M6 11l6 6 6-6" {...stroke(c)} />
    </Svg>
  );
}

/** Diagonal out-arrow used on the home Send action. */
export function IconSend({ size = 18, color }: IconProps) {
  const c = useIconColor(color);
  return (
    <Svg {...base(size)}>
      <Path d="M7 17 17 7M8 7h9v9" {...stroke(c)} />
    </Svg>
  );
}

/** Up/down pair used on the home swap action. */
export function IconSwapVertical({ size = 18, color }: IconProps) {
  const c = useIconColor(color);
  return (
    <Svg {...base(size)}>
      <Path d="M7 4v13M3 8l4-4 4 4M17 20V7M13 16l4 4 4-4" {...stroke(c)} />
    </Svg>
  );
}

/** Down/up arrow pair used on the trade flip control. */
export function IconFlip({ size = 18, color }: IconProps) {
  const c = useIconColor(color);
  return (
    <Svg {...base(size)}>
      <Path d="M8 4v13M4 13l4 4 4-4" {...stroke(c)} />
      <Path d="M16 20V7M12 11l4-4 4 4" {...stroke(c)} />
    </Svg>
  );
}

export function IconInfo({ size = 16, color }: IconProps) {
  const c = useIconColor(color, "muted");
  return (
    <Svg {...base(size)}>
      <Circle cx={12} cy={12} r={9} {...stroke(c)} />
      <Path d="M12 11v6M12 7.5v1" {...stroke(c)} />
    </Svg>
  );
}

export function IconRefresh({ size = 16, color }: IconProps) {
  const c = useIconColor(color, "muted");
  return (
    <Svg {...base(size)}>
      <Path d="M20 11a8 8 0 1 0-2.3 5.6" {...stroke(c, 1.8)} />
      <Path d="M20 5v6h-6" {...stroke(c, 1.8)} />
    </Svg>
  );
}

export function IconExpand({ size = 21, color }: IconProps) {
  const c = useIconColor(color);
  return (
    <Svg {...base(size)}>
      <Path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5" {...stroke(c)} />
      <Path d="M7 12h10" {...stroke(c)} />
    </Svg>
  );
}

export function IconWallet({ size = 21, color }: IconProps) {
  const c = useIconColor(color);
  return (
    <Svg {...base(size)}>
      <Rect x={3} y={6} width={18} height={13} {...stroke(c)} />
      <Path d="M3 10h18M16 14.5h2" {...stroke(c)} />
    </Svg>
  );
}

/** Card outline without the chip mark — the design's payment-method glyph. */
export function IconCard({ size = 18, color }: IconProps) {
  const c = useIconColor(color);
  return (
    <Svg {...base(size)}>
      <Rect x={3} y={6} width={18} height={13} {...stroke(c)} />
      <Path d="M3 10h18" {...stroke(c)} />
    </Svg>
  );
}

export function IconShield({ size = 18, color }: IconProps) {
  const c = useIconColor(color);
  return (
    <Svg {...base(size)}>
      <Path d="M12 3l7 2.6v5.6c0 4.4-2.8 7.3-7 8.8-4.2-1.5-7-4.4-7-8.8V5.6L12 3Z" {...stroke(c)} />
    </Svg>
  );
}

export function IconBackspace({ size = 20, color }: IconProps) {
  const c = useIconColor(color, "muted");
  return (
    <Svg {...base(size)}>
      <Path d="M9 5h12v14H9L3 12l6-7Z" {...stroke(c)} />
      <Path d="M12 9.5l5 5M17 9.5l-5 5" {...stroke(c)} />
    </Svg>
  );
}
