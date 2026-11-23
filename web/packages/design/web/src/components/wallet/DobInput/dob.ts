export function parseDob(
  text: string,
): { year: number; month: number; day: number } | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (!match) return null;
  const [month, day, year] = match.slice(1).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1])
    return null;
  return { year, month, day };
}

export function dobToIso(text: string): string | null {
  const date = parseDob(text);
  if (!date) return null;
  return [
    String(date.year).padStart(4, "0"),
    String(date.month).padStart(2, "0"),
    String(date.day).padStart(2, "0"),
  ].join("-");
}

export function validateDob(text: string, today: Date): string | null {
  if (!text) return null;
  if (text.split("/").some((part) => !part))
    return "Enter the month, day and year";
  const date = parseDob(text);
  if (!date || date.year < 1900) return "Enter a real date";
  const birth = date.year * 10000 + date.month * 100 + date.day;
  const current =
    today.getFullYear() * 10000 +
    (today.getMonth() + 1) * 100 +
    today.getDate();
  return birth > current ? "Date of birth can't be in the future" : null;
}
