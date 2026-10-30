import * as React from "react";
import {
  PASSKEY_ICON_EVENODD,
  PASSKEY_ICON_PATHS,
  PASSKEY_ICON_VIEWBOX,
  passkeyIconSize,
} from "../../../../tokens/src/passkeyIcon";
import "./PasskeyIcon.css";

export interface PasskeyIconProps
  extends Omit<React.SVGProps<SVGSVGElement>, "children" | "ref" | "width" | "height" | "viewBox" | "fill"> {
  /** Box size in px, 24 by default. Values under 24 are raised to 24. */
  size?: number;
  /**
   * Accessible name for icon-only use. With `title` (or `aria-label`) the svg
   * becomes an image with a matching `<title>`; without either it stays
   * `aria-hidden`, which is right beside a visible label.
   */
  title?: string;
}

/**
 * PasskeyIcon — the FIDO Alliance passkey mark (Mark A) as a supporting glyph
 * on controls that start a WebAuthn ceremony. One flat colour from
 * `currentColor`, never smaller than 24 px, never a logo or app icon.
 *
 * Beside a label, render it as a Button's first child; the Button's gap and
 * centring place it. For an icon-only control put `aria-label` + `title` on
 * the control and keep the icon hidden.
 */
export const PasskeyIcon = React.forwardRef<SVGSVGElement, PasskeyIconProps>(
  function PasskeyIcon({ size, title, className, ...props }, ref) {
    const px = passkeyIconSize(size);
    const name = props["aria-label"] ?? title;
    const cls = ["tds-passkey-icon", className].filter(Boolean).join(" ");
    return (
      <svg
        ref={ref}
        viewBox={PASSKEY_ICON_VIEWBOX}
        width={px}
        height={px}
        fill="currentColor"
        focusable="false"
        className={cls}
        aria-hidden={name === undefined ? true : undefined}
        role={name === undefined ? undefined : "img"}
        aria-label={name}
        {...props}
      >
        {title !== undefined ? <title>{title}</title> : null}
        {PASSKEY_ICON_PATHS.map((d, i) => (
          <path key={i} d={d} fillRule={PASSKEY_ICON_EVENODD[i] ? "evenodd" : undefined} />
        ))}
      </svg>
    );
  },
);
