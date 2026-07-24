/**
 * Stroke icons matching the kit's style: 24-viewBox, 1.5 stroke, square caps.
 */
import Svg, { Path, Rect, Circle } from "react-native-svg";

export interface IconProps {
  size?: number;
  color?: string;
}

function base(size: number) {
  return { width: size, height: size, viewBox: "0 0 24 24", fill: "none" } as const;
}

const stroke = (color: string) =>
  ({ stroke: color, strokeWidth: 1.5, strokeLinecap: "square" }) as const;

export function IconHome({ size = 21, color = "#181B1B" }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Path d="M4 10.5 12 4l8 6.5V20h-5.5v-5h-5v5H4v-9.5Z" {...stroke(color)} />
    </Svg>
  );
}

export function IconSwap({ size = 21, color = "#181B1B" }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Path d="M4 8h13M14 4l4 4-4 4" {...stroke(color)} />
      <Path d="M20 16H7M10 12l-4 4 4 4" {...stroke(color)} />
    </Svg>
  );
}

export function IconSettings({ size = 21, color = "#181B1B" }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Path d="M4 7h10M18 7h2M4 17h2M10 17h10" {...stroke(color)} />
      <Circle cx={16} cy={7} r={2.4} {...stroke(color)} />
      <Circle cx={7} cy={17} r={2.4} {...stroke(color)} />
    </Svg>
  );
}

export function IconCopy({ size = 18, color = "#181B1B" }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Rect x={9} y={9} width={11} height={11} {...stroke(color)} />
      <Path d="M5 15V5h10" {...stroke(color)} />
    </Svg>
  );
}

export function IconChevronRight({ size = 18, color = "#81A7A7" }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Path d="m9 5 7 7-7 7" {...stroke(color)} />
    </Svg>
  );
}

export function IconClose({ size = 18, color = "#181B1B" }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Path d="M6 6l12 12M18 6 6 18" {...stroke(color)} />
    </Svg>
  );
}

export function IconCheck({ size = 18, color = "#0A766F" }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Path d="m5 12.5 5 5L19 7" {...stroke(color)} />
    </Svg>
  );
}

export function IconLink({ size = 18, color = "#181B1B" }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Path d="M10 14a4 4 0 0 0 6 .5l3-3a4 4 0 1 0-6-6l-1.5 1.5" {...stroke(color)} />
      <Path d="M14 10a4 4 0 0 0-6-.5l-3 3a4 4 0 1 0 6 6L12.5 17" {...stroke(color)} />
    </Svg>
  );
}

export function IconDeposit({ size = 21, color = "#181B1B" }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" {...stroke(color)} />
      <Path d="M4 19h16" {...stroke(color)} />
    </Svg>
  );
}

export function IconWallet({ size = 21, color = "#181B1B" }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Rect x={3} y={6} width={18} height={13} {...stroke(color)} />
      <Path d="M3 10h18M16 14.5h2" {...stroke(color)} />
    </Svg>
  );
}
