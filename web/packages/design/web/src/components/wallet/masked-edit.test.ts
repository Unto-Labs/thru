import { describe, expect, it } from "vitest";
import { maskedEdit } from "./masked-edit";
import { IDENTITY_FORMATS } from "./IdentityNumberInput/identity";

const formatSsn = IDENTITY_FORMATS.ssn.format;

describe("maskedEdit", () => {
  it.each([
    ["backspace after the first hyphen", "123-45-6789", "12345-6789", 3, "deleteContentBackward", "124-56-789", 2],
    ["backspace after the second hyphen", "123-45-6789", "123-456789", 6, "deleteContentBackward", "123-46-789", 5],
    ["delete before the first hyphen", "123-45-6789", "12345-6789", 3, "deleteContentForward", "123-56-789", 3],
    ["typing into a full number", "123-45-6789", "1203-45-6789", 3, "insertText", "123-45-6789", 2],
    ["typing a letter", "123", "1x23", 2, "insertText", "123", 1],
    ["backspace at the end", "123-45-6789", "123-45-678", 10, "deleteContentBackward", "123-45-678", 10],
    ["pasting at the start of a full number", "123-45-6789", "555123-45-6789", 3, "insertFromPaste", "123-45-6789", 0],
    ["inserting too many digits into an empty field", "", "123456789012", 12, "insertText", "123-45-6789", 11],
    ["pasting a spaced number", "", "123 - 45 - 6789", 15, "insertFromPaste", "123-45-6789", 11],
    ["replacing a number with its unhyphenated digits", "123-45-6789", "123456789", 9, "insertFromPaste", "123-45-6789", 11],
    ["cutting only a hyphen", "123-45-6789", "12345-6789", 3, "deleteByCut", "123-45-6789", 3],
    ["pasting into the last group of a full number", "123-45-6789", "123-45-67809", 11, "insertFromPaste", "123-45-6789", 10],
  ])("SSN: %s", (_name, previous, text, caret, inputType, value, nextCaret) => {
    expect(maskedEdit(previous, text, caret, inputType, formatSsn)).toEqual({ value, caret: nextCaret });
  });
});
