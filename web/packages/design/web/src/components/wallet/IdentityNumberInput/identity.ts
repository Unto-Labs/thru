export type IdentityNumberKind = "ssn" | "bank_account" | "id";

const ID_NUMBER_MAX_LENGTH = 64;

interface IdentityFormat {
  inputMode: "numeric" | "text";
  placeholder: string;
  maxLength?: number;
  normalize(text: string): string;
  format(raw: string): string;
  validate(raw: string): string | null;
}

export const IDENTITY_FORMATS: Record<IdentityNumberKind, IdentityFormat> = {
  ssn: {
    inputMode: "numeric",
    placeholder: "123-45-6789",
    normalize: (text) => text.replace(/\D/g, "").slice(0, 9),
    format: (raw) => [raw.slice(0, 3), raw.slice(3, 5), raw.slice(5, 9)].filter(Boolean).join("-"),
    validate: (raw) => {
      if (!raw) return null;
      if (raw.length !== 9) return "Enter all 9 digits";
      if (!/^\d{9}$/.test(raw) || /^(000|666|9\d{2})/.test(raw) || raw.slice(3, 5) === "00" || raw.slice(5) === "0000") {
        return "Enter a valid SSN";
      }
      return null;
    },
  },
  bank_account: {
    inputMode: "numeric",
    placeholder: "",
    normalize: (text) => text.replace(/\D/g, "").slice(0, 17),
    format: (raw) => raw.slice(0, 17),
    validate: (raw) => (!raw || /^\d{4,17}$/.test(raw) ? null : "Enter 4 to 17 digits"),
  },
  id: {
    inputMode: "text",
    placeholder: "ID number",
    maxLength: ID_NUMBER_MAX_LENGTH,
    normalize: (text) => text.slice(0, ID_NUMBER_MAX_LENGTH),
    format: (raw) => raw,
    validate: (raw) => {
      if (!raw) return null;
      if (!raw.trim()) return "Enter an ID number";
      if (raw.length > ID_NUMBER_MAX_LENGTH)
        return `Enter at most ${ID_NUMBER_MAX_LENGTH} characters`;
      return null;
    },
  },
};
