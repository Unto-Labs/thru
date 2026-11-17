export type IdentityNumberKind = "ssn";

interface IdentityFormat {
  inputMode: "numeric";
  placeholder: string;
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
};
