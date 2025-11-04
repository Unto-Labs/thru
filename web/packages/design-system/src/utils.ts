/**
 * Utility functions for the design system
 */

/**
 * Combines class names, handling undefined/null values
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}

