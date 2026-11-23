export interface RegionOption<Code extends string = string> {
  code: Code;
  name: string;
  blockedReason?: string;
}

export function matchesRegion(
  option: RegionOption,
  query: string,
  normalize: (text: string) => string = (text) => text.toLowerCase(),
  aliases?: readonly string[],
): boolean {
  const normalized = normalize(query.trim());
  return (
    option.code.toLowerCase().startsWith(normalized) ||
    ` ${normalize(option.name)}`.includes(` ${normalized}`) ||
    aliases?.some((alias) => alias.startsWith(normalized)) === true
  );
}

export function regionOptionLabel(option: RegionOption): string {
  return option.blockedReason === undefined
    ? option.name
    : `${option.name}. ${option.blockedReason}`;
}
