import { Field as Base } from "@base-ui/react/field";
import { styledPart } from "../../lib/styled";
import "./Field.css";

/**
 * Field — the lower-level labelled-input kit (separate from the closed
 * `Input` component), exposed as styled parts. Pairs a Label, Control,
 * Description, and validation Error around a single form control.
 *
 *   <Field.Root>
 *     <Field.Label>RPC endpoint</Field.Label>
 *     <Field.Control placeholder="https://rpc.thru.org" />
 *     <Field.Description>Used for read calls only.</Field.Description>
 *     <Field.Error />
 *   </Field.Root>
 */
export const Field = {
  Root: styledPart(Base.Root, "tds-field"),
  Label: styledPart(Base.Label, "tds-field__label"),
  Control: styledPart(Base.Control, "tds-field__control"),
  Description: styledPart(Base.Description, "tds-field__desc"),
  Error: styledPart(Base.Error, "tds-field__error"),
  Validity: Base.Validity,
};
