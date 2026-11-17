import { Accordion as Base } from "@base-ui/react/accordion";
import { styledPart, styledDiv } from "../../lib/styled";
import "./Accordion.css";

/**
 * Accordion — stacked disclosure sections. Styled parts.
 *
 *   <Accordion.Root>
 *     <Accordion.Item>
 *       <Accordion.Header>
 *         <Accordion.Trigger>Title<Accordion.Chevron /></Accordion.Trigger>
 *       </Accordion.Header>
 *       <Accordion.Panel>
 *         <Accordion.PanelInner>…</Accordion.PanelInner>
 *       </Accordion.Panel>
 *     </Accordion.Item>
 *   </Accordion.Root>
 */
export const Accordion = {
  Root: styledPart(Base.Root, "uds-acc"),
  Item: styledPart(Base.Item, "uds-acc__item"),
  Header: styledPart(Base.Header, "uds-acc__header"),
  Trigger: styledPart(Base.Trigger, "uds-acc__trigger"),
  Panel: styledPart(Base.Panel, "uds-acc__panel"),
  PanelInner: styledDiv("uds-acc__panel-inner"),
};
