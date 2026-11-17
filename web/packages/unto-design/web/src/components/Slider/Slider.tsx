import { Slider as Base } from "@base-ui/react/slider";
import { styledPart, styledDiv } from "../../lib/styled";
import "./Slider.css";

/**
 * Slider — continuous value selection with a square thumb, exposed as
 * styled parts. Supports single value and range (multiple Thumbs).
 *
 *   <Slider.Root defaultValue={40}>
 *     <Slider.Head><span>slippage</span><Slider.Value /></Slider.Head>
 *     <Slider.Control>
 *       <Slider.Track>
 *         <Slider.Indicator />
 *         <Slider.Thumb />
 *       </Slider.Track>
 *     </Slider.Control>
 *   </Slider.Root>
 */
export const Slider = {
  Root: styledPart(Base.Root, "uds-slider"),
  Value: Base.Value,
  Head: styledDiv("uds-slider__head"),
  Control: styledPart(Base.Control, "uds-slider__control"),
  Track: styledPart(Base.Track, "uds-slider__track"),
  Indicator: styledPart(Base.Indicator, "uds-slider__indicator"),
  Thumb: styledPart(Base.Thumb, "uds-slider__thumb"),
};
