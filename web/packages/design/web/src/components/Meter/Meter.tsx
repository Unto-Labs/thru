import { Meter as Base } from "@base-ui/react/meter";
import { styledPart, styledDiv } from "../../lib/styled";
import "./Meter.css";

/**
 * Meter — a static measurement within a known range, exposed as styled parts.
 * Uses a secondary (grass) hue to distinguish it from Progress.
 *
 *   <Meter.Root value={78}>
 *     <Meter.Head>
 *       <Meter.Label>blockspace used</Meter.Label>
 *       <Meter.Value />
 *     </Meter.Head>
 *     <Meter.Track>
 *       <Meter.Indicator />
 *     </Meter.Track>
 *   </Meter.Root>
 */
export const Meter = {
  Root: styledPart(Base.Root, "tds-meter"),
  Head: styledDiv("tds-meter__head"),
  Label: styledPart(Base.Label, "tds-meter__label"),
  Value: styledPart(Base.Value, "tds-meter__value"),
  Track: styledPart(Base.Track, "tds-meter__track"),
  Indicator: styledPart(Base.Indicator, "tds-meter__ind"),
};
