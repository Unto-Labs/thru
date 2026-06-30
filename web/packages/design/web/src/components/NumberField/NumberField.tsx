import { NumberField as Base } from "@base-ui/react/number-field";
import { styledPart } from "../../lib/styled";
import "./NumberField.css";

/**
 * NumberField — numeric input with stepper buttons + scrub support,
 * exposed as styled parts (compose freely).
 *
 *   <NumberField.Root defaultValue={12} min={0} max={100}>
 *     <NumberField.Group>
 *       <NumberField.Decrement>−</NumberField.Decrement>
 *       <NumberField.Input />
 *       <NumberField.Increment>+</NumberField.Increment>
 *     </NumberField.Group>
 *   </NumberField.Root>
 */
export const NumberField = {
  Root: Base.Root,
  Group: styledPart(Base.Group, "tds-nf"),
  Decrement: styledPart(Base.Decrement, "tds-nf__btn"),
  Increment: styledPart(Base.Increment, "tds-nf__btn"),
  Input: styledPart(Base.Input, "tds-nf__input"),
  ScrubArea: Base.ScrubArea,
  ScrubAreaCursor: Base.ScrubAreaCursor,
};
