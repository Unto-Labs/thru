import { Dialog as Base } from "@base-ui/react/dialog";
import { styledPart, styledDiv } from "../../lib/styled";
import "./Dialog.css";

/**
 * Dialog — focus-trapping modal, exposed as styled parts (compose freely).
 *
 *   <Dialog.Root>
 *     <Dialog.Trigger render={<Button />}>Open</Dialog.Trigger>
 *     <Dialog.Portal>
 *       <Dialog.Backdrop />
 *       <Dialog.Popup>
 *         <Dialog.Head>
 *           <Dialog.Title>…</Dialog.Title>
 *           <Dialog.Close>esc ×</Dialog.Close>
 *         </Dialog.Head>
 *         <Dialog.Description>…</Dialog.Description>
 *         <Dialog.Footer>…</Dialog.Footer>
 *       </Dialog.Popup>
 *     </Dialog.Portal>
 *   </Dialog.Root>
 */
export const Dialog = {
  Root: Base.Root,
  Trigger: Base.Trigger,
  Portal: Base.Portal,
  Backdrop: styledPart(Base.Backdrop, "tds-scrim"),
  Popup: styledPart(Base.Popup, "tds-dialog"),
  Head: styledDiv("tds-dialog__head"),
  Title: styledPart(Base.Title, "tds-dialog__title"),
  Description: styledPart(Base.Description, "tds-dialog__sub"),
  Footer: styledDiv("tds-dialog__foot"),
  Close: Base.Close,
};
