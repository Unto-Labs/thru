import { OTPField as Base } from "@base-ui/react/otp-field";
import { styledPart } from "../../lib/styled";
import "./OTPField.css";

/**
 * OTPField — fixed-length one-time-code entry (square cells, one per digit),
 * exposed as styled parts.
 *
 *   <OTPField.Root length={6}>
 *     {Array.from({ length: 6 }).map((_, i) => (
 *       <OTPField.Input key={i} />
 *     ))}
 *   </OTPField.Root>
 */
export const OTPField = {
  Root: styledPart(Base.Root, "uds-otp"),
  Input: styledPart(Base.Input, "uds-otp__in"),
};
