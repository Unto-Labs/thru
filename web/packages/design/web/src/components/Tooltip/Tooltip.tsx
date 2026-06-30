import { Tooltip as Base } from "@base-ui/react/tooltip";
import { styledPart } from "../../lib/styled";
import "./Tooltip.css";

/**
 * Tooltip — small label on hover/focus. Styled parts.
 * Wrap your app (or a region) in <Tooltip.Provider> once.
 *
 *   <Tooltip.Provider>
 *     <Tooltip.Root>
 *       <Tooltip.Trigger render={<Button />}>Hover</Tooltip.Trigger>
 *       <Tooltip.Portal>
 *         <Tooltip.Positioner sideOffset={8}>
 *           <Tooltip.Popup>label</Tooltip.Popup>
 *         </Tooltip.Positioner>
 *       </Tooltip.Portal>
 *     </Tooltip.Root>
 *   </Tooltip.Provider>
 */
export const Tooltip = {
  Provider: Base.Provider,
  Root: Base.Root,
  Trigger: Base.Trigger,
  Portal: Base.Portal,
  Positioner: Base.Positioner,
  Popup: styledPart(Base.Popup, "tds-tooltip"),
  Arrow: styledPart(Base.Arrow, "tds-tooltip__arrow"),
};
