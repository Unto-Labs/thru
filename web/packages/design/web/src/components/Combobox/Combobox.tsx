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
  Input: styledPart(Base.Input, "tds-combobox-input"),
  Portal: Base.Portal,
  Positioner: Base.Positioner,
  Popup: styledPart(Base.Popup, "tds-combobox-popup"),
  List: Base.List,
  Empty: styledPart(Base.Empty, "tds-combobox-item"),
  Item: styledPart(Base.Item, "tds-combobox-item tds-combobox-item--ind"),
  ItemIndicator: styledPart(Base.ItemIndicator, "tds-combobox-item-indicator"),
};
