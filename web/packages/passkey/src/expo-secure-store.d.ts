declare module 'expo-secure-store' {
  export const WHEN_UNLOCKED_THIS_DEVICE_ONLY: string;

  export function setItemAsync(
    key: string,
    value: string,
    options?: Record<string, unknown>
  ): Promise<void>;

  export function getItemAsync(key: string): Promise<string | null>;

  export function deleteItemAsync(key: string): Promise<void>;
}
