import { Popover as Base } from "@base-ui/react/popover";
import { styledPart } from "../../lib/styled";
import "./Popover.css";

/**
 * Popover — non-modal floating panel anchored to a trigger. Styled parts.
 *
 *   <Popover.Root>
 *     <Popover.Trigger render={<Button />}>Details</Popover.Trigger>
 *     <Popover.Portal>
 *       <Popover.Positioner sideOffset={8}>
 *         <Popover.Popup>
 *           <Popover.Title>…</Popover.Title>
 *           <Popover.Description>…</Popover.Description>
 *         </Popover.Popup>
 *       </Popover.Positioner>
 *     </Popover.Portal>
 *   </Popover.Root>
 */
export const Popover = {
  Root: Base.Root,
  Trigger: Base.Trigger,
  Portal: Base.Portal,
  Positioner: Base.Positioner,
  Popup: styledPart(Base.Popup, "tds-popover"),
  /* Chrome-free Popup for large bespoke panels (e.g. selectors): the consumer
     supplies width / padding / border / background; only the shared entrance
     fade is baked in, so app-owned panels animate in consistently. */
  PanelPopup: styledPart(Base.Popup, "tds-popover-panel"),
  Title: styledPart(Base.Title, "tds-popover__title"),
  Description: styledPart(Base.Description, "tds-popover__desc"),
  Arrow: styledPart(Base.Arrow, "tds-popover__arrow"),
  Close: Base.Close,
};
