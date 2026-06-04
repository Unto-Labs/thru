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
}
