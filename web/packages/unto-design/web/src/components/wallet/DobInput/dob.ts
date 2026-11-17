export function formatDob(text: string): string {
  const digits = text.replace(/\D/g, "").slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join("/");
}

export function parseDob(text: string): { year: number; month: number; day: number } | null {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(text)) return null;
  const month = Number(text.slice(0, 2));
  const day = Number(text.slice(3, 5));
  const year = Number(text.slice(6));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) return null;
  return { year, month, day };
}

export function dobToIso(text: string): string | null {
  return parseDob(text) ? `${text.slice(6)}-${text.slice(0, 2)}-${text.slice(3, 5)}` : null;
}

export function validateDob(text: string, today: Date): string | null {
  if (!text) return null;
  if (text.length < 10) return "Enter the full date as MM/DD/YYYY";
  const date = parseDob(text);
  if (!date || date.year < 1900) return "Enter a real date";
  const birth = date.year * 10000 + date.month * 100 + date.day;
  const current = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  return birth > current ? "Date of birth can't be in the future" : null;
}
