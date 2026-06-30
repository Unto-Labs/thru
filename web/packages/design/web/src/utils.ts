/** Combine class names, dropping falsy values. Mirrors the legacy design-system's cn(). */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(" ");
}
