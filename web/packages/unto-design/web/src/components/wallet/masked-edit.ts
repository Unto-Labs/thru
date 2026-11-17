import type { ChangeEvent } from "react";

const digitsOf = (text: string) => text.replace(/\D/g, "");

function afterDigits(text: string, count: number): number {
  let position = 0;
  for (let seen = 0; seen < count && position < text.length; position += 1) {
    if (/\d/.test(text[position])) seen += 1;
  }
  return position;
}

/* `text` and `caret` are the field after the browser applied the edit; `format` caps the digit count. */
export function maskedEdit(
  previous: string,
  text: string,
  caret: number,
  inputType: string | undefined,
  format: (digits: string) => string,
): { value: string; caret: number } {
  let digits = digitsOf(text);
  let before = digitsOf(text.slice(0, caret)).length;

  /* A delete that left every digit in place only removed separators, so it takes the adjacent digit too. */
  if (inputType?.startsWith("delete") && inputType !== "deleteByCut" && digits === digitsOf(previous)) {
    if (!inputType.endsWith("Forward")) before -= 1;
    digits = digits.slice(0, before) + digits.slice(before + 1);
  }

  const value = format(digits);
  /* Keeping this edit would push digits after the caret off the end and could leave a different valid value. */
  if (digitsOf(value).length < digits.length && before < digits.length) {
    const inserted = digits.length - digitsOf(previous).length;
    return { value: previous, caret: afterDigits(previous, before - inserted) };
  }
  return { value, caret: afterDigits(value, before) };
}

export function applyMaskedEdit(
  event: ChangeEvent<HTMLInputElement>,
  previous: string,
  format: (digits: string) => string,
): string {
  const input = event.target;
  const { value, caret } = maskedEdit(
    previous,
    input.value,
    input.selectionStart ?? input.value.length,
    (event.nativeEvent as InputEvent).inputType,
    format,
  );
  /* Writing the DOM here means React's controlled write finds nothing to change and leaves the caret alone. */
  input.value = value;
  input.setSelectionRange(caret, caret);
  return value;
}
