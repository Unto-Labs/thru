import { Combobox as Base } from "@base-ui/react/combobox";
import { styledPart } from "../../lib/styled";
import "./Combobox.css";

/**
 * Combobox — a filterable picker (type to narrow the list), exposed as styled
 * parts (compose freely).
 *
 *   <Combobox.Root items={chains}>
 *     <Combobox.Input placeholder="Search chains…" />
 *     <Combobox.Portal>
 *       <Combobox.Positioner sideOffset={6}>
 *         <Combobox.Popup>
 *           <Combobox.Empty>No chains found.</Combobox.Empty>
 *           <Combobox.List>
 *             {(item) => (
 *               <Combobox.Item key={item} value={item}>
 *                 <Combobox.ItemIndicator>✓</Combobox.ItemIndicator>
 *                 {item}
 *               </Combobox.Item>
 *             )}
 *           </Combobox.List>
 *         </Combobox.Popup>
 *       </Combobox.Positioner>
 *     </Combobox.Portal>
 *   </Combobox.Root>
 */
export const Combobox = {
  Root: Base.Root,
  Trigger: Base.Trigger,
  Value: Base.Value,
  Icon: Base.Icon,
  Input: styledPart(Base.Input, "uds-combobox-input"),
  Portal: Base.Portal,
  Positioner: Base.Positioner,
  Popup: styledPart(Base.Popup, "uds-combobox-popup"),
  List: Base.List,
  Empty: styledPart(Base.Empty, "uds-combobox-item"),
  Item: styledPart(Base.Item, "uds-combobox-item uds-combobox-item--ind"),
  ItemIndicator: styledPart(Base.ItemIndicator, "uds-combobox-item-indicator"),
};
