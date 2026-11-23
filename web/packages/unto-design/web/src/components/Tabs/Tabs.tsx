import { Tabs as Base } from "@base-ui/react/tabs";
import { styledPart } from "../../lib/styled";
import "./Tabs.css";

/**
 * Tabs — switch panels with an animated accent indicator. Styled parts.
 *
 *   <Tabs.Root defaultValue="overview">
 *     <Tabs.List>
 *       <Tabs.Tab value="overview">Overview</Tabs.Tab>
 *       <Tabs.Tab value="specs">Specs</Tabs.Tab>
 *       <Tabs.Indicator />
 *     </Tabs.List>
 *     <Tabs.Panel value="overview">…</Tabs.Panel>
 *     <Tabs.Panel value="specs">…</Tabs.Panel>
 *   </Tabs.Root>
 */
export const Tabs = {
  Root: styledPart(Base.Root, "uds-tabs"),
  List: styledPart(Base.List, "uds-tabs__list"),
  Tab: styledPart(Base.Tab, "uds-tabs__tab"),
  Indicator: styledPart(Base.Indicator, "uds-tabs__indicator"),
  Panel: styledPart(Base.Panel, "uds-tabs__panel"),
};
