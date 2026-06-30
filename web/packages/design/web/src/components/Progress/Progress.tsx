import { Progress as Base } from "@base-ui/react/progress";
import { styledPart, styledDiv } from "../../lib/styled";
import "./Progress.css";

/**
 * Progress — determinate task progress, exposed as styled parts.
 *
 *   <Progress.Root value={62}>
 *     <Progress.Head>
 *       <Progress.Label>deploying</Progress.Label>
 *       <Progress.Value />
 *     </Progress.Head>
 *     <Progress.Track>
 *       <Progress.Indicator />
 *     </Progress.Track>
 *   </Progress.Root>
 */
export const Progress = {
  Root: styledPart(Base.Root, "tds-progress"),
  Head: styledDiv("tds-progress__head"),
  Label: styledPart(Base.Label, "tds-progress__label"),
  Value: styledPart(Base.Value, "tds-progress__value"),
  Track: styledPart(Base.Track, "tds-progress__track"),
  Indicator: styledPart(Base.Indicator, "tds-progress__ind"),
};
