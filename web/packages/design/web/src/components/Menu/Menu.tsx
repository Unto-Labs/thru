import { Menu as Base } from "@base-ui/react/menu";
import { styledPart, styledDiv } from "../../lib/styled";
import "./Menu.css";

/**
 * Menu — an actions menu with items, separators, and grouped labels, exposed as
 * styled parts (compose freely).
 *
 *   <Menu.Root>
 *     <Menu.Trigger render={<Button />}>Actions</Menu.Trigger>
 *     <Menu.Portal>
 *       <Menu.Positioner sideOffset={6} align="start">
 *         <Menu.Popup>
 *           <Menu.Item>Duplicate</Menu.Item>
 *           <Menu.Item>Rename</Menu.Item>
 *           <Menu.Separator />
 *           <Menu.Group>
 *             <Menu.GroupLabel>Danger</Menu.GroupLabel>
 *             <Menu.Item>Delete</Menu.Item>
 *           </Menu.Group>
 *         </Menu.Popup>
 *       </Menu.Positioner>
 *     </Menu.Portal>
 *   </Menu.Root>
 */
export const Menu = {
  Root: Base.Root,
  Trigger: Base.Trigger,
  Portal: Base.Portal,
  Positioner: Base.Positioner,
  Popup: styledPart(Base.Popup, "tds-menu-popup"),
  Item: styledPart(Base.Item, "tds-menu-item"),
  Separator: styledDiv("tds-menu-sep"),
  Group: Base.Group,
  GroupLabel: styledPart(Base.GroupLabel, "tds-menu-label"),
};
