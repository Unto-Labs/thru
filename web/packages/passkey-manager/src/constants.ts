export const PASSKEY_MANAGER_PROGRAM_ADDRESS =
  'taUDdQyFxvM5i0HFRkEK3W45kWLyblAHSnMg4zplgUnz6Z';

// Instruction discriminants
export const INSTRUCTION_CREATE = 0x00;
export const INSTRUCTION_VALIDATE = 0x01;
export const INSTRUCTION_TRANSFER = 0x02;
export const INSTRUCTION_INVOKE = 0x03;
export const INSTRUCTION_ADD_AUTHORITY = 0x04;
export const INSTRUCTION_REMOVE_AUTHORITY = 0x05;
export const INSTRUCTION_REGISTER_CREDENTIAL = 0x06;

// Authority tags
export const AUTHORITY_TAG_PASSKEY = 1;
export const AUTHORITY_TAG_PUBKEY = 2;
