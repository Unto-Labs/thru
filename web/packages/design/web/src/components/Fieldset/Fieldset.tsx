import { Fieldset as Base } from "@base-ui/react/fieldset";
import { styledPart } from "../../lib/styled";
import "./Fieldset.css";

/**
 * Fieldset — groups related fields under a legend, exposed as styled parts.
 *
 *   <Fieldset.Root>
 *     <Fieldset.Legend>Network</Fieldset.Legend>
 *     …fields…
 *   </Fieldset.Root>
 */
export const Fieldset = {
  Root: styledPart(Base.Root, "tds-fieldset"),
  Legend: styledPart(Base.Legend, "tds-fieldset__legend"),
};
