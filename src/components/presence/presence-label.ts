"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";

import type { PresenceStatus } from "@/lib/presence";

/**
 * Localized twin of `presenceLabel` / `formatLastSeen` from
 * `@/lib/presence`. The lib stays pure (and its unit tests keep
 * asserting the English wording); components that render the label
 * use this hook so the tooltip follows the active UI language.
 *
 * Same buckets as `formatLastSeen`: just now / minutes / hours / days,
 * with "a while ago" for a missing or unparseable timestamp.
 */
export function usePresenceLabel() {
  const t = useTranslations("Presence");

  const formatLastSeen = useCallback(
    (lastSeenAt: string | null | undefined, now: number): string => {
      if (!lastSeenAt) return t("lastSeen.unknown");
      const last = new Date(lastSeenAt).getTime();
      if (Number.isNaN(last)) return t("lastSeen.unknown");

      const diff = Math.max(0, now - last);
      const mins = Math.floor(diff / 60_000);
      if (mins < 1) return t("lastSeen.justNow");
      if (mins < 60) return t("lastSeen.minutes", { count: mins });

      const hours = Math.floor(mins / 60);
      if (hours < 24) return t("lastSeen.hours", { count: hours });

      return t("lastSeen.days", { count: Math.floor(hours / 24) });
    },
    [t],
  );

  return useCallback(
    (
      status: PresenceStatus,
      lastSeenAt: string | null | undefined,
      now: number,
    ): string => {
      switch (status) {
        case "online":
          return t("online");
        case "away":
          return t("away");
        case "offline":
          return t("offline", { lastSeen: formatLastSeen(lastSeenAt, now) });
      }
    },
    [t, formatLastSeen],
  );
}
