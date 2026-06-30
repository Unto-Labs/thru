import { Toggle as BaseToggle } from "@base-ui/react/toggle";
import { ToggleGroup as BaseToggleGroup } from "@base-ui/react/toggle-group";
import { styledPart } from "../../lib/styled";
import "./Toggle.css";

/**
 * Toggle — a single pressable two-state button, exposed as a styled part.
 *
 *   <Toggle pressed={on} onPressedChange={setOn}>Watch</Toggle>
 *
 * Pressed state is styled in CSS via Base UI's [data-pressed] hook.
 */
export const Toggle = styledPart(BaseToggle, "tds-toggle");

/**
 * ToggleGroup — a segmented group of toggles (single- or multi-select),
 * exposed as a styled part. Compose `Toggle.Group` around `Toggle.Item`s:
 *
 *   <Toggle.Group value={v} onValueChange={setV}>
 *     <Toggle.Item value="bold">B</Toggle.Item>
 *     <Toggle.Item value="italic">I</Toggle.Item>
 *   </Toggle.Group>
 *
 * The group enforces square-first borders; each item styles its pressed state
 * via [data-pressed].
 */
export const ToggleGroup = {
  Group: styledPart(BaseToggleGroup, "tds-seg"),
  Item: styledPart(BaseToggle, "tds-seg__btn"),
};
