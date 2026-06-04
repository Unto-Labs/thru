const DEFAULT_LABEL = 'Thru Wallet passkey';

export interface DistinctPasskeyLabelOptions {
  existingLabels?: Iterable<string | null | undefined>;
  maxAttempts?: number;
  suffixFactory?: () => string;
}

export function createDistinctPasskeyLabel(
  baseLabel: string,
  _options: DistinctPasskeyLabelOptions = {}
): string {
  return baseLabel.trim() || DEFAULT_LABEL;
}
