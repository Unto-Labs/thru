import * as React from "react";
import { cn } from "../../utils";

/**
 * Typography components — thin wrappers that apply the `.type-*` classes shipped
 * by @thru/design/tokens (typography.css). No Base UI primitive exists for text,
 * so these stay plain elements. API matches the legacy design-system's Text 1:1
 * (`as`, `bold`, `className`, pass-through props).
 *
 * The foundation stylesheet (`@thru/design/web/styles.css` or
 * `@thru/design/tokens/theme.css`) must be imported once per app so the
 * `.type-*` classes are present.
 */
export interface TextProps extends React.HTMLAttributes<HTMLElement> {
  as?: React.ElementType;
  bold?: boolean;
}

function make(normal: string, boldClass: string) {
  const Component = ({ as: As = "p", bold, className, children, ...props }: TextProps) =>
    React.createElement(
      As,
      { className: cn(normal, bold && boldClass, className), ...props },
      children,
    );
  Component.displayName = normal;
  return Component;
}

export const Heading1 = make("type-heading-1", "type-heading-1-bold");
export const Heading2 = make("type-heading-2", "type-heading-2-bold");
export const Heading3 = make("type-heading-3", "type-heading-3-bold");
export const Heading4 = make("type-heading-4", "type-heading-4-bold");
export const Heading5 = make("type-heading-5", "type-heading-5-bold");

export const Body1 = make("type-body-1", "type-body-1-bold");
export const Body3 = make("type-body-3", "type-body-3-bold");
export const Body4 = make("type-body-4", "type-body-4-bold");
export const Body5 = make("type-body-5", "type-body-5-bold");

export const Ui1 = make("type-ui-1", "type-ui-1-bold");
export const Ui2 = make("type-ui-2", "type-ui-2-bold");
export const Ui3 = make("type-ui-3", "type-ui-3-bold");
export const Ui4 = make("type-ui-4", "type-ui-4-bold");
export const Ui5 = make("type-ui-5", "type-ui-5-bold");

export const Button1 = make("type-button-1", "type-button-1-bold");

export type TextVariant =
  | "heading1" | "heading2" | "heading3" | "heading4" | "heading5"
  | "body1" | "body3" | "body4" | "body5"
  | "ui1" | "ui2" | "ui3" | "ui4" | "ui5"
  | "button1";

export interface TextComponentProps extends TextProps {
  variant?: TextVariant;
}

/**
 * Text — generic typography with a `variant` prop, for when you don't want a
 * named component. `<Text variant="body3" as="p">…</Text>`.
 */
export function Text({
  variant = "body3",
  as: As = "p",
  bold,
  className,
  children,
  ...props
}: TextComponentProps) {
  const base = "type-" + variant.replace(/([a-z])(\d)/, "$1-$2");
  return React.createElement(
    As,
    { className: cn(base, bold && `${base}-bold`, className), ...props },
    children,
  );
}

/** Paragraph — the default body paragraph (type-body-3, renders <p>). */
export const Paragraph = Body3;
