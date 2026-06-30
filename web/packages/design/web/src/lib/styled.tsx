import * as React from "react";
import { cn } from "../utils";

/**
 * Wrap a Base UI part with a default `tds-` class, preserving Base UI's
 * `className` contract (string OR function-of-state) and forwarding ref + props.
 * The styled-parts building block for compound components — keeps the
 * compositional API Base UI intends while baking in our look.
 */
export function styledPart<C extends React.ElementType>(Part: C, base: string) {
  type P = React.ComponentPropsWithoutRef<C>;
  const Comp = Part as React.ElementType;
  const Styled = React.forwardRef<unknown, P>(function Styled(props, ref) {
    const { className, ...rest } = props as P & {
      className?: string | ((state: Record<string, unknown>) => string);
    };
    const merged = (state: Record<string, unknown>) =>
      cn(base, typeof className === "function" ? className(state) : className);
    return <Comp ref={ref} className={merged} {...rest} />;
  });
  Styled.displayName = `tds(${base})`;
  return Styled as React.ForwardRefExoticComponent<P & React.RefAttributes<unknown>>;
}

/** A styled plain `<div>` for layout parts that aren't Base UI primitives. */
export function styledDiv(base: string) {
  const Styled = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    function Styled({ className, ...rest }, ref) {
      return <div ref={ref} className={cn(base, className)} {...rest} />;
    },
  );
  Styled.displayName = `tds(${base})`;
  return Styled;
}
