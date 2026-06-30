import { Toolbar as Base } from "@base-ui/react/toolbar";
import { styledPart } from "../../lib/styled";
import "./Toolbar.css";

/**
 * Toolbar — a roving-focus container grouping related controls into a
 * horizontal bar, exposed as styled parts (compose freely).
 *
 *   <Toolbar.Root aria-label="Formatting">
 *     <Toolbar.Button render={<Button variant="ghost" size="sm" />}>Export</Toolbar.Button>
 *     <Toolbar.Separator />
 *     <Toolbar.Link href="#">edited 51m ago</Toolbar.Link>
 *   </Toolbar.Root>
 *
 * The `render` prop lets each Button/Link adopt another component's look (a
 * Toggle, our Button, an anchor) while keeping toolbar roving-focus semantics.
 */
export const Toolbar = {
  Root: styledPart(Base.Root, "tds-toolbar"),
  Button: Base.Button,
  Link: styledPart(Base.Link, "tds-toolbar-link"),
  Separator: styledPart(Base.Separator, "tds-toolbar-sep"),
  Group: Base.Group,
  Input: styledPart(Base.Input, "tds-toolbar-input"),
};
