import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { Anton, Bebas_Neue, Montserrat, Oswald } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { ThemeProvider } from "@/hooks/use-theme";
import { ThemedToaster } from "@/components/themed-toaster";
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  LEGACY_DEFAULT_THEME,
  MODE_STORAGE_KEY,
  MODES,
  STORAGE_KEY,
  THEME_IDS,
  THEME_MIGRATED_KEY,
} from "@/lib/themes";

// The four ConstruSuite faces, each with one job (brand manual §06).
//
// A note on `display`, because the two settings are not interchangeable
// here: body and headline text use `swap` so nothing is ever invisible,
// while the wordmark and the endorsement use `block`. The manual
// forbids substituting the typeface, and `swap` would paint
// "ConstruSuite" in Montserrat for ~100ms on a cold cache — a visible
// brand violation on every first paint. `block` shows nothing, then
// Oswald. Do not "fix" those two to `swap`.

/** Body, tables, docs. Variable font — no `weight`, so next/font pulls
 *  the single wght-axis file rather than four static cuts. */
const montserrat = Montserrat({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

/** Titulares — page H1s and card titles. Ships weight 400 only. */
const bebasNeue = Bebas_Neue({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

/** The word "ConstruSuite". Nothing else. */
const oswald = Oswald({
  variable: "--font-wordmark",
  subsets: ["latin"],
  weight: "700",
  display: "block",
});

/** The word "NATION" in the endorsement. Nothing else. */
const anton = Anton({
  variable: "--font-endorsement",
  subsets: ["latin"],
  weight: "400",
  display: "block",
});

export const metadata: Metadata = {
  title: {
    default: "ConstruSuite",
    template: "%s — ConstruSuite",
  },
  description:
    "ConstruSuite — sistema de gestión integrado: bandeja compartida de WhatsApp, contactos, embudos de venta, difusiones y automatizaciones.",
  robots: {
    index: false,
    follow: false,
  },
  icons: {
    icon: [{ url: "/icon" }],
    apple: [{ url: "/apple-icon" }],
  },
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
};

export const viewport: Viewport = {
  // The brand's negro base, matching DEFAULT_MODE. Next's array form only
  // understands `prefers-color-scheme`, which tracks the OS rather than
  // this app's own data-mode, so the boot script below rewrites this tag
  // once it knows the resolved mode.
  themeColor: "#0A0A0A",
  colorScheme: "dark light",
};

// Inline boot script — runs before React hydrates so the user's
// chosen accent (data-theme) AND mode (data-mode) are on the <html>
// element before first paint. Without this every page load flashes
// the server-rendered defaults for a frame before the React tree
// mounts and applies the picked values.
//
// Kept dependency-free (no imports, no JSX) — must be a string the
// browser can run as a single <script>. Knowledge of valid ids is
// sourced from the THEME_IDS / MODES constants so adding one doesn't
// silently break the boot path.
const THEME_BOOT_SCRIPT = `
(function(){
  var d = document.documentElement;
  try {
    var THEME_KEY = ${JSON.stringify(STORAGE_KEY)};
    var THEME_DEFAULT = ${JSON.stringify(DEFAULT_THEME)};
    var THEMES = ${JSON.stringify(THEME_IDS)};
    var savedTheme = localStorage.getItem(THEME_KEY);

    // One-time ConstruSuite rebrand migration. Changing DEFAULT_THEME
    // alone only reaches browsers with nothing stored, so every existing
    // install would keep the old violet accent forever. Move anyone still
    // sitting on the previous default across exactly once, and record it
    // — so a user who deliberately re-picks violet afterwards keeps it,
    // and anyone who had chosen another accent is never touched.
    var MIGRATED_KEY = ${JSON.stringify(THEME_MIGRATED_KEY)};
    if (!localStorage.getItem(MIGRATED_KEY)) {
      if (savedTheme === ${JSON.stringify(LEGACY_DEFAULT_THEME)}) {
        savedTheme = THEME_DEFAULT;
        localStorage.setItem(THEME_KEY, THEME_DEFAULT);
      }
      localStorage.setItem(MIGRATED_KEY, "1");
    }

    d.dataset.theme = THEMES.indexOf(savedTheme) !== -1 ? savedTheme : THEME_DEFAULT;

    var MODE_KEY = ${JSON.stringify(MODE_STORAGE_KEY)};
    var MODE_DEFAULT = ${JSON.stringify(DEFAULT_MODE)};
    var MODES = ${JSON.stringify(MODES)};
    var savedMode = localStorage.getItem(MODE_KEY);
    d.dataset.mode = MODES.indexOf(savedMode) !== -1 ? savedMode : MODE_DEFAULT;

    // Keep the mobile browser chrome on the app's mode, not the OS's.
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", d.dataset.mode === "light" ? "#FFFFFF" : "#0A0A0A");
  } catch (_e) {
    d.dataset.theme = ${JSON.stringify(DEFAULT_THEME)};
    d.dataset.mode = ${JSON.stringify(DEFAULT_MODE)};
  }
})();
`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      data-theme={DEFAULT_THEME}
      data-mode={DEFAULT_MODE}
      className={`${montserrat.variable} ${bebasNeue.variable} ${oswald.variable} ${anton.variable} h-full antialiased`}
      // The `theme-boot` script below rewrites `data-theme` and
      // `data-mode` on <html> from localStorage before React hydrates,
      // so for any non-default choice the client DOM intentionally
      // differs from the server-rendered defaults. suppressHydration-
      // Warning silences the expected mismatch — it only applies to
      // this element's own attributes, so genuine mismatches in
      // children still surface.
      suppressHydrationWarning
    >
      <head>
        <Script
          id="theme-boot"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }}
        />
      </head>
      <body className="min-h-full bg-background text-foreground font-sans">
        <NextIntlClientProvider messages={messages} locale={locale}>
          <ThemeProvider>
            {children}
            <ThemedToaster />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
