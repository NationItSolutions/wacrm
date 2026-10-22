// ============================================================
// Supported UI locales.
//
// Single source of truth for the language pack list. `request.ts`
// resolves the active locale from (1) the `wacrm-locale` cookie set by
// the Appearance language selector, (2) the NEXT_PUBLIC_APP_LOCALE env
// default, then (3) DEFAULT_LOCALE (es-419). Each locale maps to `messages/<locale>.json`.
// ============================================================

export const DEFAULT_LOCALE = 'es-419'

export const SUPPORTED_LOCALES = ['en', 'es-419'] as const
export type AppLocale = (typeof SUPPORTED_LOCALES)[number]

/** Native label shown in the language picker. */
export const LOCALE_LABELS: Record<string, string> = {
  en: 'English',
  'es-419': 'Español (Latinoamérica)',
}

export function isSupportedLocale(value: string | null | undefined): value is AppLocale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

/** Cookie the Appearance language selector writes to switch languages. */
export const LOCALE_COOKIE = 'wacrm-locale'
