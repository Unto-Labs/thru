declare module 'react-native-passkeys' {
  export interface PasskeyCreateResponse {
    id: string;
    response: {
      getPublicKey?: () => string | undefined;
    };
  }

  export interface PasskeyGetResponse {
    id: string;
    response: {
      signature: string;
      authenticatorData: string;
      clientDataJSON: string;
    };
  }

  export function create(
    request: Record<string, unknown>
  ): Promise<PasskeyCreateResponse | null>;

  export function get(
    request: Record<string, unknown>
  ): Promise<PasskeyGetResponse | null>;
}
