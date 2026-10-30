import * as React from "react";
import { Button as BaseButton } from "@base-ui/react/button";
import "./Button.css";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost";
export type ButtonSize = "lg" | "md" | "sm" | "xs";

type BaseButtonProps = React.ComponentProps<typeof BaseButton>;

export interface ButtonProps extends Omit<BaseButtonProps, "className"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}

/**
 * Button — built on Base UI's Button primitive. Pass `render` to render as
 * another element (e.g. a link) while keeping button semantics.
 */
export const Button = React.forwardRef<HTMLElement, ButtonProps>(
  function Button({ variant = "primary", size = "md", className, ...props }, ref) {
    const cls = ["tds-btn", `tds-btn--${variant}`, `tds-btn--${size}`, className]
      .filter(Boolean)
      .join(" ");
    return <BaseButton ref={ref} className={cls} {...props} />;
  },
);
