export const MANAGER_ERROR_TYPES = {
  0x0100: 'SIZE_ERROR',
  0x0200: 'VALUE_ERROR',
  0x0300: 'AUTHORIZATION_ERROR',
  0x0400: 'INDEX_ERROR',
  0x0500: 'NOT_AVAILABLE_ERROR',
  0x0600: 'RELATIONSHIP_ERROR',
  0x0700: 'STATE_ERROR',
  0x0800: 'NOT_WRITABLE_ERROR',
  0x0900: 'INVALID_PROGRAM',
} as const;

export const MANAGER_ERROR_OBJECTS = {
  0x01: 'INSTRUCTION',
  0x02: 'DISCRIMINANT',
  0x03: 'SOURCE_BUFFER_ACCOUNT',
  0x04: 'META_ACCOUNT',
  0x05: 'PROGRAM_ACCOUNT',
  0x06: 'AUTHORITY_ACCOUNT',
  0x07: 'AUTHORITY_CANDIDATE_ACCOUNT',
} as const;

export interface DecodedManagerError {
  code: number;
  typeCode: number;
  type: string | undefined;
  objectCode: number;
  object: string | undefined;
}

export function decodeManagerError(code: number): DecodedManagerError {
  if (!Number.isInteger(code) || code < 0 || code > 0xffff) {
    throw new Error('manager error code must be a u16');
  }
  const typeCode = code & 0xff00;
  const objectCode = code & 0xff;
  return {
    code,
    typeCode,
    type: MANAGER_ERROR_TYPES[typeCode as keyof typeof MANAGER_ERROR_TYPES],
    objectCode,
    object:
      MANAGER_ERROR_OBJECTS[
        objectCode as keyof typeof MANAGER_ERROR_OBJECTS
      ],
  };
}
