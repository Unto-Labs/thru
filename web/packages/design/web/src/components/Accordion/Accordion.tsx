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
  Root: styledPart(Base.Root, "tds-acc"),
  Item: styledPart(Base.Item, "tds-acc__item"),
  Header: styledPart(Base.Header, "tds-acc__header"),
  Trigger: styledPart(Base.Trigger, "tds-acc__trigger"),
  Panel: styledPart(Base.Panel, "tds-acc__panel"),
  PanelInner: styledDiv("tds-acc__panel-inner"),
};
