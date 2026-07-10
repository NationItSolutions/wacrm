import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, LOCALE_COOKIE, isSupportedLocale } from './locales';

export default getRequestConfig(async () => {
  // Resolve the active locale, most specific first:
  //   1. the `wacrm-locale` cookie (set by the Appearance language picker),
  //   2. the NEXT_PUBLIC_APP_LOCALE deployment default,
  //   3. English.
  // Only locales in SUPPORTED_LOCALES are honoured, so a stale/hostile
  // cookie can't point the dynamic import at an arbitrary path.
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  const envLocale = process.env.NEXT_PUBLIC_APP_LOCALE;

  const locale = isSupportedLocale(cookieLocale)
    ? cookieLocale
    : isSupportedLocale(envLocale)
      ? envLocale
      : DEFAULT_LOCALE;

  let messages;
  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch {
    // Fallback to English if the dictionary for the requested locale
    // doesn't exist yet.
    messages = (await import(`../../messages/en.json`)).default;
  }

  return {
    locale,
    messages,
  };
});
