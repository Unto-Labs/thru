import * as React from "react";
import "./Tag.css";

export type TagTone = "neutral" | "dark" | "brick" | "sky" | "grass" | "yellow";

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: TagTone;
}

/**
 * Tag (a.k.a. Chip) — a solid-fill mono label. A Thru house component, not a
 * Base UI primitive. Square by default (never a rounded pill).
 *
 * `tone` selects the fill/text pair. thru-design's accent tones map onto our
 * canonical accent families: ocean→sky, forest→grass, saffron→yellow.
 */
export const Tag = React.forwardRef<HTMLSpanElement, TagProps>(function Tag(
  { tone = "neutral", className, ...props },
  ref,
) {
  const cls = ["tds-tag", `tds-tag--${tone}`, className].filter(Boolean).join(" ");
  return <span ref={ref} className={cls} {...props} />;
});
