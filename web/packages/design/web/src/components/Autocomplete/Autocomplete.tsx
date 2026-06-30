import { Autocomplete as Base } from "@base-ui/react/autocomplete";
import { styledPart } from "../../lib/styled";
import "./Autocomplete.css";

/**
 * Autocomplete — an input with inline suggestions as you type, exposed as
 * styled parts (compose freely).
 *
 *   <Autocomplete.Root items={chains}>
 *     <Autocomplete.Input placeholder="Type a chain…" />
 *     <Autocomplete.Portal>
 *       <Autocomplete.Positioner sideOffset={6}>
 *         <Autocomplete.Popup>
 *           <Autocomplete.Empty>No matches.</Autocomplete.Empty>
 *           <Autocomplete.List>
 *             {(item) => (
 *               <Autocomplete.Item key={item} value={item}>{item}</Autocomplete.Item>
 *             )}
 *           </Autocomplete.List>
 *         </Autocomplete.Popup>
 *       </Autocomplete.Positioner>
 *     </Autocomplete.Portal>
 *   </Autocomplete.Root>
 */
export const Autocomplete = {
  Root: Base.Root,
  Input: styledPart(Base.Input, "tds-autocomplete-input"),
  Portal: Base.Portal,
  Positioner: Base.Positioner,
  Popup: styledPart(Base.Popup, "tds-autocomplete-popup"),
  List: Base.List,
  Empty: styledPart(Base.Empty, "tds-autocomplete-item"),
  Item: styledPart(Base.Item, "tds-autocomplete-item"),
};
