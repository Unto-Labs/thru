import { describe, expect, it } from "vitest";
import { maskedEdit } from "./masked-edit";
import { formatDob } from "./DobInput/dob";
import { IDENTITY_FORMATS } from "./IdentityNumberInput/identity";

const formatSsn = IDENTITY_FORMATS.ssn.format;

describe("maskedEdit", () => {
  it.each([
    ["backspace after the first slash", "07/04/1990", "0704/1990", 2, "deleteContentBackward", "00/41/990", 1],
    ["backspace after the second slash", "07/04/1990", "07/041990", 5, "deleteContentBackward", "07/01/990", 4],
    ["delete before the first slash", "07/04/1990", "0704/1990", 2, "deleteContentForward", "07/41/990", 2],
    ["backspace on a middle digit", "07/04/1990", "07/4/1990", 3, "deleteContentBackward", "07/41/990", 2],
    ["typing into a full date", "07/04/1990", "07/094/1990", 5, "insertText", "07/04/1990", 4],
    ["pasting a spaced date", "", "07 / 04 / 1990", 14, "insertFromPaste", "07/04/1990", 10],
    ["replacing a date with its unspaced digits", "07/04/1990", "07041990", 8, "insertFromPaste", "07/04/1990", 10],
    ["cutting only a slash", "07/04/1990", "0704/1990", 2, "deleteByCut", "07/04/1990", 2],
    ["pasting into the year of a full date", "07/04/1990", "07/04/19910", 10, "insertFromPaste", "07/04/1990", 9],
    ["pasting too many digits into an empty field", "", "07/04/19901", 11, "insertFromPaste", "07/04/1990", 10],
  ])("date: %s", (_name, previous, text, caret, inputType, value, nextCaret) => {
    expect(maskedEdit(previous, text, caret, inputType, formatDob)).toEqual({ value, caret: nextCaret });
  });

  it.each([
    ["backspace after the first hyphen", "123-45-6789", "12345-6789", 3, "deleteContentBackward", "124-56-789", 2],
    ["backspace after the second hyphen", "123-45-6789", "123-456789", 6, "deleteContentBackward", "123-46-789", 5],
    ["delete before the first hyphen", "123-45-6789", "12345-6789", 3, "deleteContentForward", "123-56-789", 3],
    ["typing into a full number", "123-45-6789", "1203-45-6789", 3, "insertText", "123-45-6789", 2],
    ["typing a letter", "123", "1x23", 2, "insertText", "123", 1],
    ["backspace at the end", "123-45-6789", "123-45-678", 10, "deleteContentBackward", "123-45-678", 10],
    ["pasting at the start of a full number", "123-45-6789", "555123-45-6789", 3, "insertFromPaste", "123-45-6789", 0],
    ["inserting too many digits into an empty field", "", "123456789012", 12, "insertText", "123-45-6789", 11],
  ])("SSN: %s", (_name, previous, text, caret, inputType, value, nextCaret) => {
    expect(maskedEdit(previous, text, caret, inputType, formatSsn)).toEqual({ value, caret: nextCaret });
  });
});
