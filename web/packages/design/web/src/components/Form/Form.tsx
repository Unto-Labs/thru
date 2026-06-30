import { Form as Base } from "@base-ui/react/form";
import { styledPart } from "../../lib/styled";
import "./Form.css";

/**
 * Form — thin styled wrapper over Base UI's Form. Coordinates field-level
 * validation/errors for the Field kit it wraps; layout only.
 *
 *   <Form onSubmit={…}>
 *     <Field.Root>…</Field.Root>
 *     <Button type="submit">Validate</Button>
 *   </Form>
 */
export const Form = styledPart(Base, "tds-form");
