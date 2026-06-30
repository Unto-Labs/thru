import { AlertDialog as Base } from "@base-ui/react/alert-dialog";
import { styledPart, styledDiv } from "../../lib/styled";
import "../Dialog/Dialog.css";

/**
 * AlertDialog — a modal that demands a decision (no dismiss-by-backdrop).
 * Same look as Dialog (reuses Dialog.css), exposed as styled parts.
 */
export const AlertDialog = {
  Root: Base.Root,
  Trigger: Base.Trigger,
  Portal: Base.Portal,
  Backdrop: styledPart(Base.Backdrop, "tds-scrim"),
  Popup: styledPart(Base.Popup, "tds-dialog"),
  Title: styledPart(Base.Title, "tds-dialog__title"),
  Description: styledPart(Base.Description, "tds-dialog__sub"),
  Footer: styledDiv("tds-dialog__foot"),
  Close: Base.Close,
};
