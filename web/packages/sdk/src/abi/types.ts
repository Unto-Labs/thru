export interface ByteRange {
  offset: number;
  size: number;
}

export type FormattedValue =
  | null
  | string
  | number
  | boolean
  | bigint
  | FormattedValue[]
  | { [key: string]: FormattedValue }
  | { variant: string; value: FormattedValue | null };

/* Value with byte range information (when includeByteOffsets is true) */
export type FormattedValueWithByteRange =
  | { value: FormattedValue; _byteRange: ByteRange }
  | { hex: string; _byteRange: ByteRange }
  | { variant: string; value: FormattedValue | null; _byteRange: ByteRange };

export interface FormattedReflection {
  typeName: string;
  kind: string | null | undefined;
  value: FormattedValue;
  byteRange?: ByteRange;
  /** Friendly cards, one per struct whose ABI declares a `display-name`. */
  display?: DisplayCard[];
}

/** A friendly view of one decoded struct: a heading plus its visible fields. */
export interface DisplayCard {
  /** Field and variant names from the root to this struct. */
  path: string[];
  typeName: string;
  title: string;
  /** Visible fields in ABI order. Rows without a value failed; see `status`. */
  rows: DisplayRow[];
  /** True when a visible field could not be computed ("Some details unavailable"). */
  incomplete: boolean;
}

/**
 * How people read a value in one line. Well-known ABI types declare one; a
 * formatted well-known object carries it as `display: { kind, text }`.
 */
export type DisplayKind =
  | "address"
  | "signature"
  | "hash"
  | "time"
  | "date"
  | "duration"
  | "decimal"
  | "money"
  | "color"
  | "bool"
  | "text";

/** The `display` key of a formatted well-known value. */
export interface DisplayForm {
  kind: DisplayKind;
  text: string;
}

export interface DisplayRow {
  name: string;
  label: string;
  /** "wire" fields come from bytes; "synthetic" fields are computed and have no bytes. */
  source: "wire" | "synthetic";
  /**
   * A well-known type's display kind, or for plain values `integer`, `text`,
   * `bool`, `none` or `value` (anything else). Integers are decimal strings,
   * so large values stay exact; a display kind's value is its display text.
   */
  kind: DisplayKind | "integer" | "none" | "value";
  value?: FormattedValue;
  status: "ok" | "unavailable" | "error";
  /** Why the value is missing, for technical details. */
  issue?: string;
  /** Synthetic rows only: the ABI expression that computes the value. */
  expression?: string;
  /** Synthetic rows only: the declared return type as written, such as `Pubkey`, `u64` or `optional<Text>`. */
  returnType?: string;
}
