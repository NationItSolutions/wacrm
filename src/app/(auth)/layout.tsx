import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";

import { Endorsement, Logo } from "@/components/brand/logo";

// Shared metadata for auth pages (login / signup / forgot-password).
// None of these should be indexed — they'd compete with the marketing
// landing in SERPs and offer nothing to a searcher who hasn't already
// signed up. Each page still gets its own <title> via its own
// metadata.title override below the route group layout.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

/**
 * The brand's front door — the split from the manual's login mock.
 *
 * The shell lives here rather than in each page for two reasons: the
 * three pages used to repeat the same centring wrapper five times, and
 * "POWERED BY NATION belongs only on auth" becomes a structural fact
 * instead of something to remember. The endorsement is rendered here and
 * nowhere else in the app.
 */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("Brand");

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* Pinned to the base black in BOTH modes. The negativo is the
          manual's primary usage, and a panel that followed the mode would
          collapse into the form column on one side or the other. This is
          the one surface in the app that deliberately opts out of the
          theme tokens. */}
      {/* The hairline is the split. In dark mode the panel and the form
          column are both #0A0A0A, so without it the two halves fuse into
          one black field — and a 1px rule is the manual's own separator
          rather than an invented one. */}
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-white/10 bg-[#0A0A0A] p-12 text-white lg:flex">
        {/* Surface watermark (manual §07): the reduced mark, whole and
            very faint. Deliberately not bled past the panel edge — a
            cropped cross reads as two stray rectangles, not as the mark.
            Decorative only. */}
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-10 right-10 select-none"
        >
          <Logo variant="mark" className="text-[260px] text-white/[0.03]" />
        </span>

        <Logo variant="A" size="lg" tone="negative" className="relative" />

        <div className="relative flex flex-col gap-10">
          <p className="max-w-sm text-2xl italic text-white/70">
            {t("tagline")}
          </p>
          <Endorsement className="w-40 text-white" />
        </div>
      </aside>

      <main className="flex flex-col items-center justify-center bg-background px-4 py-10">
        {/* Below lg the brand panel is gone, so the lockup rides above the
            form. Variant C — wordmark centred over the hairline and the
            endorsement — is the manual's "centrado con respaldo", which is
            exactly this shape: a narrow centred column opening a document. */}
        <div className="mb-10 lg:hidden">
          <Logo variant="C" size="md" />
        </div>

        {children}
      </main>
    </div>
  );
}
