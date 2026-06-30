import { ScrollArea as Base } from "@base-ui/react/scroll-area";
import { styledPart } from "../../lib/styled";
import "./ScrollArea.css";

/**
 * ScrollArea — custom-styled scroll container with a thin hairline scrollbar.
 * Styled parts.
 *
 *   <ScrollArea.Root>
 *     <ScrollArea.Viewport>
 *       <ScrollArea.Content>…</ScrollArea.Content>
 *     </ScrollArea.Viewport>
 *     <ScrollArea.Scrollbar>
 *       <ScrollArea.Thumb />
 *     </ScrollArea.Scrollbar>
 *   </ScrollArea.Root>
 */
export const ScrollArea = {
  Root: styledPart(Base.Root, "tds-scrollarea"),
  Viewport: styledPart(Base.Viewport, "tds-scrollarea__viewport"),
  Content: Base.Content,
  Scrollbar: styledPart(Base.Scrollbar, "tds-scrollarea__scrollbar"),
  Thumb: styledPart(Base.Thumb, "tds-scrollarea__thumb"),
};
