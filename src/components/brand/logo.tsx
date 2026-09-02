import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * The ConstruSuite logo, per the brand manual (Nation IT Solutions, v1.0).
 *
 * Server-safe on purpose: no `"use client"`, no hooks, no state. The
 * `(auth)` layout is a server component that exports `metadata`, and
 * pulling a client boundary in there would be a silent perf regression.
 *
 * The manual's prohibitions are enforced structurally rather than by
 * convention, so a caller can't violate them by accident:
 *
 *   • "no estirar ni deformar" — every dimension is an `em` derived from
 *     one font-size on the root, so the cross/wordmark/gap ratio is
 *     locked. There is no prop that scales one against the other.
 *   • "no separar cruz y wordmark" — the two are siblings inside a single
 *     flex row with no conditional between them. Variant "C" is the one
 *     separation the manual itself sanctions.
 *   • "tamaño mínimo 120px" — `min-w-[120px]` on every lockup that
 *     carries the wordmark, and `LogoSize` has no step below `sm`.
 *   • "no cambiar la tipografía" — the wordmark is live text in
 *     `--font-wordmark` (Oswald 700), loaded with `display: "block"` in
 *     the root layout so it is never painted in a substitute face.
 */

/** Fixed capitalisation: capital C, capital S. Never translated, never
 *  uppercased or lowercased, never interpolated into another string. */
export const BRAND_NAME = "ConstruSuite";

/** Manual §04 — the floor for any lockup carrying the wordmark. Below
 *  this the only legal reduction is `variant="mark"`. */
export const LOGO_MIN_WIDTH_PX = 120;

/** Cross height as a fraction of the wordmark's font-size. Oswald's cap
 *  height is ~0.73em, so the cross's arms sit flush with the caps of the
 *  "C" and the "S". */
const CROSS_EM = "0.72em";

/** Space between cross and wordmark. The manual says "immediately
 *  follows" without giving a value; half the cross height (two arm
 *  widths) reads as one unit without the right arm kerning into the C. */
const GAP_EM = "0.36em";

type Lockup = "A" | "B" | "C" | "mark";
type LogoSize = "sm" | "md" | "lg" | "xl";

/**
 * Wordmark font-size per step. `sm` is the smallest step whose lockup A
 * still clears LOGO_MIN_WIDTH_PX — "ConstruSuite" in Oswald Bold runs
 * ~5.3em, so 20 × 5.3 + cross 14.4 + gap 7.2 ≈ 127px. There is
 * deliberately no smaller step: the type is the enforcement.
 */
const SIZE_CLASS: Record<LogoSize, string> = {
  sm: "text-[20px]",
  md: "text-[28px]",
  lg: "text-[40px]",
  xl: "text-[56px]",
};

const TONE_CLASS = {
  inherit: "",
  negative: "text-white",
  positive: "text-[#0A0A0A]",
} as const;

/**
 * The geometric greek cross. Arm thickness = 25/100 = 25% of the overall
 * width, exactly as specified. `currentColor` so negativo/positivo is a
 * decision the call site makes with a text colour — the asset itself
 * never carries one.
 */
export function BrandCross({ className, ...props }: ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
      {...props}
    >
      <path d="M37.5 0h25v37.5H100v25H62.5V100h-25V62.5H0v-25h37.5z" />
    </svg>
  );
}

/**
 * "POWERED BY / NATION" — the endorsement, over a hairline rule.
 *
 * Exported separately so the auth layout can place it independently of
 * the lockup. It belongs ONLY on the auth screens; every other surface
 * uses variant A or the reduced mark.
 *
 * The DOM text is mixed-case with `uppercase` applied in CSS — literal
 * all-caps makes some screen readers spell words out letter by letter.
 * The manual's all-caps prohibition covers the wordmark, not this
 * endorsement, which is specified in caps.
 */
export function Endorsement({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex flex-col", className)}>
      <span aria-hidden className="mb-2 h-px w-full bg-current opacity-25" />
      <span className="font-endorsement text-[9px] leading-none tracking-[0.42em] uppercase opacity-50">
        Powered by
      </span>
      <span className="font-endorsement mt-1 text-[13px] leading-none tracking-[0.3em] uppercase opacity-80">
        Nation
      </span>
    </span>
  );
}

export interface LogoProps {
  /**
   * Manual §03 lockups:
   *   "A"    — horizontal principal: cross + wordmark. Headers, splash.
   *   "B"    — A, plus the hairline and POWERED BY NATION. AUTH ONLY.
   *   "C"    — wordmark alone, centred, plus the endorsement. AUTH ONLY.
   *   "mark" — cross alone. The only legal reduction below 120px, and
   *            the only form allowed as a decorative watermark.
   */
  variant?: Lockup;
  size?: LogoSize;
  /** Override the variant's default. Do not set this true outside the
   *  `(auth)` route group. */
  endorsement?: boolean;
  /** Reserve the manual's clear space (X = cross height) as padding.
   *  Off by default: most call sites already sit in a container whose
   *  padding is >= X, and turning it on there double-pads. */
  clearSpace?: boolean;
  /** "inherit" paints from currentColor. "negative"/"positive" pin an
   *  absolute value for surfaces that must not follow light/dark mode. */
  tone?: "inherit" | "negative" | "positive";
  className?: string;
}

export function Logo({
  variant = "A",
  size = "md",
  endorsement,
  clearSpace = false,
  tone = "inherit",
  className,
}: LogoProps) {
  const showEndorsement = endorsement ?? (variant === "B" || variant === "C");
  const clearSpaceStyle = clearSpace ? { padding: CROSS_EM } : undefined;

  // Reduced mark — cross alone. No wordmark, so no min-width floor.
  if (variant === "mark") {
    return (
      <span
        className={cn(
          "inline-flex leading-none",
          SIZE_CLASS[size],
          TONE_CLASS[tone],
          className,
        )}
        style={clearSpaceStyle}
      >
        <BrandCross style={{ width: CROSS_EM, height: CROSS_EM }} />
        <span className="sr-only">{BRAND_NAME}</span>
      </span>
    );
  }

  const lockup = (
    <span
      className="inline-flex items-center leading-none"
      style={{ gap: GAP_EM }}
    >
      {variant !== "C" && (
        <BrandCross style={{ width: CROSS_EM, height: CROSS_EM }} />
      )}
      <span className="font-wordmark font-bold tracking-[0.005em] whitespace-nowrap">
        {BRAND_NAME}
      </span>
    </span>
  );

  return (
    <span
      className={cn(
        "inline-flex flex-col",
        variant === "C" ? "items-center text-center" : "items-start",
        // If Oswald renders narrower than estimated the lockup just gains
        // trailing space — it can never render below the minimum.
        "min-w-[120px]",
        SIZE_CLASS[size],
        TONE_CLASS[tone],
        className,
      )}
      style={clearSpaceStyle}
    >
      {lockup}
      {showEndorsement && <Endorsement className="mt-[0.45em] w-full" />}
    </span>
  );
}
