import { Avatar as Base } from "@base-ui/react/avatar";
import { styledPart } from "../../lib/styled";
import "./Avatar.css";

/**
 * Avatar — image with an initials fallback, exposed as styled parts.
 * Square by default (override the corner radius inline / via className).
 *
 *   <Avatar.Root>
 *     <Avatar.Image src="…" />
 *     <Avatar.Fallback>LH</Avatar.Fallback>
 *   </Avatar.Root>
 */
export const Avatar = {
  Root: styledPart(Base.Root, "tds-avatar"),
  Image: styledPart(Base.Image, "tds-avatar__img"),
  Fallback: styledPart(Base.Fallback, "tds-avatar__fallback"),
};
