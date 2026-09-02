import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The page-level H1.
 *
 * Bebas Neue (`--font-display`) in caps, in the manual's headline colour
 * (`--foreground-strong` = #FFFFFF on the negativo, #0A0A0A on the
 * positivo). Extracted because the recipe was about to be pasted into
 * a dozen page components, and because it keeps the "which headings are
 * display type" decision in one reviewable place.
 *
 * Deliberately NOT for headings that render user data — a broadcast or
 * automation name pushed into a caps-only face is the user's text
 * altered. Those keep a plain `<h1>`.
 *
 * The manual's 96–220px scale is for brand surfaces (splash, auth), not
 * for a dense CRM page header; this sits at a working size instead.
 */
export function PageTitle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h1
      className={cn(
        "font-display text-3xl leading-[0.9] font-normal tracking-[0.01em] uppercase text-foreground-strong",
        className,
      )}
    >
      {children}
    </h1>
  );
}
