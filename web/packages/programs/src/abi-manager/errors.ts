export const ABI_MANAGER_ERROR_REASONS = {
  0x01: 'INVALID_ACCOUNT_INDEX',
  0x02: 'ACCOUNT_NOT_FOUND',
  0x03: 'ACCOUNT_NOT_WRITABLE',
  0x04: 'INVALID_SIZE',
  0x05: 'INVALID_OWNER',
  0x06: 'INVALID_AUTHORITY',
  0x07: 'INVALID_STATE',
  0x08: 'ACCOUNT_ALREADY_EXISTS',
} as const;

export const ABI_MANAGER_ERROR_COMPONENTS = {
  0x0100: 'INSTRUCTION',
  0x0200: 'PROGRAM_META',
  0x0300: 'ABI_ACCOUNT',
  0x0400: 'SOURCE_BUFFER',
  0x0500: 'ABI_META',
  0x0600: 'ABI_META_KIND',
} as const;

export interface DecodedABIManagerError {
  code: number;
  reasonCode: number;
  reason: string | undefined;
  componentCode: number;
  component: string | undefined;
}

export function decodeABIManagerError(code: number): DecodedABIManagerError {
  if (!Number.isInteger(code) || code < 0 || code > 0xffff) {
    throw new Error('ABI manager error code must be a u16');
  }
  const reasonCode = code & 0xff;
  const componentCode = code & 0xff00;
  return {
    code,
    reasonCode,
    reason:
      ABI_MANAGER_ERROR_REASONS[
        reasonCode as keyof typeof ABI_MANAGER_ERROR_REASONS
      ],
    componentCode,
    component:
      ABI_MANAGER_ERROR_COMPONENTS[
        componentCode as keyof typeof ABI_MANAGER_ERROR_COMPONENTS
      ],
  };
}
