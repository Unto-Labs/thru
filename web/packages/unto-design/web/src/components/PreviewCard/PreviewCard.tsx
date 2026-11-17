import { PreviewCard as Base } from "@base-ui/react/preview-card";
import { styledPart } from "../../lib/styled";
import "../Popover/Popover.css";

/**
 * PreviewCard — rich hover preview for a link/entity, exposed as styled parts.
 */
export const PreviewCard = {
  Root: Base.Root,
  Trigger: Base.Trigger,
  Portal: Base.Portal,
  Positioner: Base.Positioner,
  Popup: styledPart(Base.Popup, "uds-popover"),
  Arrow: styledPart(Base.Arrow, "uds-popover__arrow"),
};
