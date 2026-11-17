import { AlertDialog as Base } from "@base-ui/react/alert-dialog";
import { styledPart, styledDiv } from "../../lib/styled";
import "../Dialog/Dialog.css";

/**
 * AlertDialog — a modal that demands a decision (no dismiss-by-backdrop).
 */
export const AlertDialog = {
  Root: Base.Root,
  Trigger: Base.Trigger,
  Portal: Base.Portal,
  Backdrop: styledPart(Base.Backdrop, "uds-scrim"),
  Popup: styledPart(Base.Popup, "uds-dialog"),
  Title: styledPart(Base.Title, "uds-dialog__title"),
  Description: styledPart(Base.Description, "uds-dialog__sub"),
  Footer: styledDiv("uds-dialog__foot"),
  Close: Base.Close,
};
