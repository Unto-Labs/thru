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
  Backdrop: styledPart(Base.Backdrop, "uds-scrim"),
  Popup: styledPart(Base.Popup, "uds-dialog"),
  Head: styledDiv("uds-dialog__head"),
  Title: styledPart(Base.Title, "uds-dialog__title"),
  Description: styledPart(Base.Description, "uds-dialog__sub"),
  Footer: styledDiv("uds-dialog__foot"),
  Close: Base.Close,
};
