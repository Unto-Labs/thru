import { Meter as Base } from "@base-ui/react/meter";
import { styledPart, styledDiv } from "../../lib/styled";
import "./Meter.css";

/**
 * Meter — a static measurement within a known range, exposed as styled parts.
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
  Root: styledPart(Base.Root, "uds-meter"),
  Head: styledDiv("uds-meter__head"),
  Label: styledPart(Base.Label, "uds-meter__label"),
  Value: styledPart(Base.Value, "uds-meter__value"),
  Track: styledPart(Base.Track, "uds-meter__track"),
  Indicator: styledPart(Base.Indicator, "uds-meter__ind"),
};
