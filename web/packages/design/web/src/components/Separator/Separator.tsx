import * as React from "react";
import { Separator as BaseSeparator } from "@base-ui/react/separator";
import "./Separator.css";

type BaseSeparatorProps = React.ComponentProps<typeof BaseSeparator>;

export interface SeparatorProps extends Omit<BaseSeparatorProps, "className"> {
  orientation?: "horizontal" | "vertical";
  className?: string;
}

/**
 * Separator — a hairline divider, built on Base UI's Separator primitive.
 *
 * Base UI supplies the correct ARIA orientation; the look is plain CSS over
 * tokens. Sections are divided by rules, not shadows.
 */
export const Separator = React.forwardRef<HTMLDivElement, SeparatorProps>(
  function Separator({ orientation = "horizontal", className, ...props }, ref) {
    const cls = ["tds-sep", `tds-sep--${orientation}`, className]
      .filter(Boolean)
      .join(" ");
    return (
      <BaseSeparator ref={ref} orientation={orientation} className={cls} {...props} />
    );
  },
);
