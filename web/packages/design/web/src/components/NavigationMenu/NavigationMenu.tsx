import { NavigationMenu as Base } from "@base-ui/react/navigation-menu";
import { styledPart } from "../../lib/styled";
import "./NavigationMenu.css";

/**
 * NavigationMenu — site-nav with rich content popups. Styled parts.
 *
 *   <NavigationMenu.Root>
 *     <NavigationMenu.List>
 *       <NavigationMenu.Item>
 *         <NavigationMenu.Trigger>Build</NavigationMenu.Trigger>
 *         <NavigationMenu.Content>
 *           <NavigationMenu.Link href="#"><b>…</b><span>…</span></NavigationMenu.Link>
 *         </NavigationMenu.Content>
 *       </NavigationMenu.Item>
 *     </NavigationMenu.List>
 *     <NavigationMenu.Portal>
 *       <NavigationMenu.Positioner sideOffset={8}>
 *         <NavigationMenu.Popup>
 *           <NavigationMenu.Viewport />
 *         </NavigationMenu.Popup>
 *       </NavigationMenu.Positioner>
 *     </NavigationMenu.Portal>
 *   </NavigationMenu.Root>
 */
export const NavigationMenu = {
  Root: styledPart(Base.Root, "tds-navmenu"),
  List: styledPart(Base.List, "tds-navmenu__list"),
  Item: Base.Item,
  Trigger: styledPart(Base.Trigger, "tds-navmenu__trigger"),
  Content: styledPart(Base.Content, "tds-navmenu__content"),
  Link: styledPart(Base.Link, "tds-navmenu__link"),
  Portal: Base.Portal,
  Positioner: styledPart(Base.Positioner, "tds-navmenu__positioner"),
  Popup: styledPart(Base.Popup, "tds-navmenu__popup"),
  Viewport: Base.Viewport,
};
