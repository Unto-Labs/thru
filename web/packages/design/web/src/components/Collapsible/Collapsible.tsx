import { Collapsible as Base } from "@base-ui/react/collapsible";
import { styledPart, styledDiv } from "../../lib/styled";
import "./Collapsible.css";

/**
 * Collapsible — a single show/hide region with height animation. Styled parts.
 *
 *   <Collapsible.Root>
 *     <Collapsible.Trigger render={<Button variant="ghost" size="sm" />}>
 *       Toggle advanced
 *     </Collapsible.Trigger>
 *     <Collapsible.Panel>
 *       <Collapsible.Inner>…</Collapsible.Inner>
 *     </Collapsible.Panel>
 *   </Collapsible.Root>
 */
export const Collapsible = {
  Root: Base.Root,
  Trigger: Base.Trigger,
  Panel: styledPart(Base.Panel, "tds-coll__panel"),
  Inner: styledDiv("tds-coll__inner"),
};
