import { getEffectiveLocale, t } from './i18n';
import type { DateParts, ExperienceEntry } from './types';

export function formatDate(d: DateParts | null): string {
  if (!d) return t('present');
  if (!d.year) return '';
  if (d.month && d.month >= 1 && d.month <= 12) {
    const month = new Intl.DateTimeFormat(getEffectiveLocale(), { month: 'short' }).format(
      new Date(d.year, d.month - 1),
    );
    return `${month} ${d.year}`;
  }
  return String(d.year);
}

/** "Jan 2020 – Present" for the aggregate tenure of an entry. */
export function formatTenure(entry: ExperienceEntry): string {
  const start = formatDate(entry.start);
  const end = formatDate(entry.end);
  if (!start) return end;
  return `${start} – ${end}`;
}

/** Up to two uppercase initials from a name or company. */
export function initials(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
