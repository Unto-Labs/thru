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
  Root: styledPart(Base.Root, "tds-slider"),
  Value: Base.Value,
  Head: styledDiv("tds-slider__head"),
  Control: styledPart(Base.Control, "tds-slider__control"),
  Track: styledPart(Base.Track, "tds-slider__track"),
  Indicator: styledPart(Base.Indicator, "tds-slider__indicator"),
  Thumb: styledPart(Base.Thumb, "tds-slider__thumb"),
};
