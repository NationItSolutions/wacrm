import { es } from 'date-fns/locale'
import type { Locale } from 'date-fns'

/**
 * date-fns locale for an app locale. English is date-fns' built-in
 * default, so it maps to `undefined` (no `locale` option needed).
 */
export function dateFnsLocale(appLocale: string | null | undefined): Locale | undefined {
  return appLocale?.toLowerCase().startsWith('es') ? es : undefined
}
