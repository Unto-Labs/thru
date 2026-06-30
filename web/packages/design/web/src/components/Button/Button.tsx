import * as React from "react";
import { Button as BaseButton } from "@base-ui/react/button";
import "./Button.css";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost";
export type ButtonSize = "md" | "sm" | "xs";

type BaseButtonProps = React.ComponentProps<typeof BaseButton>;

export interface ButtonProps extends Omit<BaseButtonProps, "className"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}

/**
 * Button — built on Base UI's Button primitive.
 *
 * Base UI handles the behavior consistently (disabled semantics, keyboard
 * activation, `data-*` state attributes for styling, and the `render` prop
 * for polymorphism — e.g. render as a link while keeping button semantics).
 * The look is supplied by `Button.css` against the design tokens. The
 * variant/size API matches the legacy design-system so call sites migrate 1:1.
 */
export const Button = React.forwardRef<HTMLElement, ButtonProps>(
  function Button({ variant = "primary", size = "md", className, ...props }, ref) {
    const cls = ["tds-btn", `tds-btn--${variant}`, `tds-btn--${size}`, className]
      .filter(Boolean)
      .join(" ");
    return <BaseButton ref={ref} className={cls} {...props} />;
  },
);
