import { PreviewCard as Base } from "@base-ui/react/preview-card";
import { styledPart } from "../../lib/styled";
import "../Popover/Popover.css";

/**
 * PreviewCard — rich hover preview for a link/entity. Reuses the Popover look,
 * exposed as styled parts.
 */
export const PreviewCard = {
  Root: Base.Root,
  Trigger: Base.Trigger,
  Portal: Base.Portal,
  Positioner: Base.Positioner,
  Popup: styledPart(Base.Popup, "tds-popover"),
  Arrow: styledPart(Base.Arrow, "tds-popover__arrow"),
};
