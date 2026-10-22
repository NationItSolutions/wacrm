'use client';

import { useLocale } from 'next-intl';
import { dateFnsLocale } from '@/lib/i18n/date-locale';

/**
 * Active locale helpers for client components.
 *   - `locale`: BCP-47 tag for Intl / toLocale*String (e.g. 'es-419').
 *   - `dateLocale`: matching date-fns locale for format / formatDistance.
 */
export function useDateLocale() {
  const locale = useLocale();
  return { locale, dateLocale: dateFnsLocale(locale) };
}
