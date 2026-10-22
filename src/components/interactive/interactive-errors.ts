"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";

/**
 * Localizes the English messages returned by `validateInteractivePayload`
 * (`@/lib/whatsapp/interactive`). The validator is shared with API routes
 * and the automation engine, so it keeps emitting plain English; the UI
 * maps each known message to an `Interactive.errors.*` key at render time.
 *
 * Patterns must stay in lockstep with the `fail(...)` calls in the lib.
 * Anything unrecognised (e.g. a message added later) falls through
 * unchanged rather than disappearing.
 */
type Rule = {
  pattern: RegExp;
  key: string;
  /** Names for the capture groups, in order. */
  params?: string[];
};

const RULES: Rule[] = [
  { pattern: /^Interactive message payload is required\.$/, key: "payloadRequired" },
  { pattern: /^Interactive message body text is required\.$/, key: "bodyRequired" },
  { pattern: /^Body text exceeds the (\d+)-character limit\.$/, key: "bodyTooLong", params: ["max"] },
  { pattern: /^Header exceeds the (\d+)-character limit\.$/, key: "headerTooLong", params: ["max"] },
  { pattern: /^Footer exceeds the (\d+)-character limit\.$/, key: "footerTooLong", params: ["max"] },
  { pattern: /^Add at least one reply button\.$/, key: "buttonsRequired" },
  { pattern: /^A reply-button message allows at most (\d+) buttons\.$/, key: "tooManyButtons", params: ["max"] },
  { pattern: /^Every button needs an id\.$/, key: "buttonIdRequired" },
  { pattern: /^Duplicate button id "(.*)"\.$/, key: "duplicateButtonId", params: ["id"] },
  { pattern: /^Every button needs a label\.$/, key: "buttonLabelRequired" },
  { pattern: /^Button label "(.*)" exceeds the (\d+)-character limit\.$/, key: "buttonLabelTooLong", params: ["label", "max"] },
  { pattern: /^The list needs a button label\.$/, key: "listButtonRequired" },
  { pattern: /^List button label exceeds the (\d+)-character limit\.$/, key: "listButtonTooLong", params: ["max"] },
  { pattern: /^Add at least one list section\.$/, key: "sectionsRequired" },
  { pattern: /^A list allows at most (\d+) sections\.$/, key: "tooManySections", params: ["max"] },
  { pattern: /^Every list section needs rows\.$/, key: "sectionRowsRequired" },
  { pattern: /^Every list row needs an id\.$/, key: "rowIdRequired" },
  { pattern: /^Duplicate list row id "(.*)"\.$/, key: "duplicateRowId", params: ["id"] },
  { pattern: /^Every list row needs a title\.$/, key: "rowTitleRequired" },
  { pattern: /^List row title "(.*)" exceeds the (\d+)-character limit\.$/, key: "rowTitleTooLong", params: ["title", "max"] },
  { pattern: /^List row description exceeds the (\d+)-character limit\.$/, key: "rowDescriptionTooLong", params: ["max"] },
  { pattern: /^Add at least one list row\.$/, key: "rowsRequired" },
  { pattern: /^A list allows at most (\d+) rows in total\.$/, key: "tooManyRows", params: ["max"] },
  { pattern: /^Interactive message must be reply buttons or a list\.$/, key: "invalidKind" },
];

/** Returns `(englishError) => localizedError`. */
export function useInteractiveErrorMessage() {
  const t = useTranslations("Interactive.errors");
  return useCallback(
    (error: string): string => {
      for (const rule of RULES) {
        const m = rule.pattern.exec(error);
        if (!m) continue;
        const values: Record<string, string> = {};
        rule.params?.forEach((name, i) => {
          values[name] = m[i + 1];
        });
        return t(rule.key, values);
      }
      return error;
    },
    [t],
  );
}
