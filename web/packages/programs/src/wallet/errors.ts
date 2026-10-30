export enum WalletProgramError {
  AuthorityExpired = 91,
  PasskeyRequired = 92,
  SessionExpiryTooLong = 93,
}

export function walletProgramErrorFromCode(code: number | bigint): WalletProgramError | null {
  switch (code) {
    case 91:
    case 91n:
      return WalletProgramError.AuthorityExpired;
    case 92:
    case 92n:
      return WalletProgramError.PasskeyRequired;
    case 93:
    case 93n:
      return WalletProgramError.SessionExpiryTooLong;
    default:
      return null;
  }
}

export function walletProgramErrorMessage(error: WalletProgramError): string {
  switch (error) {
    case WalletProgramError.AuthorityExpired:
      return 'This wallet authority has expired. Approve a new session with your passkey.';
    case WalletProgramError.PasskeyRequired:
      return 'This wallet change requires direct passkey approval.';
    case WalletProgramError.SessionExpiryTooLong:
      return 'A session must expire within 24 hours and no later than its parent session.';
  }
}
