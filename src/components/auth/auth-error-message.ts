"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";

/**
 * Supabase Auth returns English `message`s. For the common, stable error
 * `code`s we show a localized `Auth.errors.*` string instead; anything
 * else falls back to Supabase's own message so nothing is swallowed.
 */
const KNOWN_CODES: Record<string, string> = {
  invalid_credentials: "invalidCredentials",
  email_not_confirmed: "emailNotConfirmed",
  user_already_exists: "userAlreadyExists",
  email_exists: "userAlreadyExists",
  weak_password: "weakPassword",
  email_address_invalid: "emailInvalid",
  over_email_send_rate_limit: "rateLimited",
  over_request_rate_limit: "rateLimited",
  signup_disabled: "signupDisabled",
};

export function useAuthErrorMessage() {
  const t = useTranslations("Auth.errors");
  return useCallback(
    (error: { code?: string; message: string }): string => {
      const key = error.code ? KNOWN_CODES[error.code] : undefined;
      return key ? t(key) : error.message;
    },
    [t],
  );
}
