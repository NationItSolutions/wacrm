/**
 * Single source of truth for the color-theme catalog.
 *
 * The CSS variables themselves live in `src/app/globals.css` under
 * `html[data-theme="..."]` blocks — that file is the one we paste
 * theme tokens into. This module only carries the metadata the UI
 * (settings picker, no-flash boot script) needs.
 *
 * Adding a new theme is a two-step change:
 *   1. Append the new `html[data-theme="<id>"]` block in globals.css
 *      with every token from an existing theme (use violet as the
 *      shape reference).
 *   2. Add an entry below. The order here drives the picker grid.
 */

export const THEME_IDS = [
  "mono",
  "violet",
  "emerald",
  "cobalt",
  "amber",
  "rose",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export const DEFAULT_THEME: ThemeId = "mono";

export const STORAGE_KEY = "wacrm.theme";

/**
 * Marker for the one-time move of pre-rebrand installs onto `mono`.
 *
 * Changing DEFAULT_THEME only affects browsers with nothing stored, so
 * without this every existing user would stay on the old violet default
 * and never see the ConstruSuite identity. The boot script in
 * `src/app/layout.tsx` rewrites a stored "violet" to "mono" exactly once
 * and sets this key. Anyone who deliberately picked emerald/cobalt/amber/
 * rose keeps their accent, and picking violet again *after* the migration
 * sticks, because the flag is already set.
 */
export const THEME_MIGRATED_KEY = "wacrm.theme.migrated";

/** The accent the migration above moves away from. */
export const LEGACY_DEFAULT_THEME = "violet";

/**
 * MODE — the light/dark dimension, orthogonal to the accent theme.
 *
 * The CSS variables live in `src/app/globals.css` under
 * `html[data-mode="..."]` blocks (neutral surfaces only). Applied
 * at runtime via `document.documentElement.dataset.mode`. Dark is
 * the historical default and stays the app's identity; light is the
 * opt-in eye-strain-friendly alternative.
 *
 * Persisted under its own localStorage key so it composes freely
 * with the accent choice (you can run Violet-light or Violet-dark).
 */
export const MODES = ["light", "dark"] as const;

export type Mode = (typeof MODES)[number];

export const DEFAULT_MODE: Mode = "dark";

export const MODE_STORAGE_KEY = "wacrm.mode";

export function isMode(value: unknown): value is Mode {
  return (
    typeof value === "string" && (MODES as ReadonlyArray<string>).includes(value)
  );
}

export interface ThemeMeta {
  id: ThemeId;
  /**
   * English fallback label. The rendered name and tagline come from
   * `Settings.appearance.themes.<id>` in the message catalogs — this
   * stays as a non-rendered default for logs and for any consumer that
   * has no translator in scope.
   */
  name: string;
  /**
   * Static swatch color for the picker chip. Hard-coded so the boot
   * script / picker cards don't need a getComputedStyle round trip
   * before the page settles. Must mirror `--primary` of the same
   * theme in globals.css.
   */
  swatch: string;
}

export const THEMES: ReadonlyArray<ThemeMeta> = [
  {
    id: "mono",
    name: "Mono",
    /**
     * Split diagonally rather than solid, for two reasons: a solid white
     * chip disappears on the light picker card and a solid black one
     * disappears on the dark card, and the split is also an honest
     * preview — this is the one accent that inverts with the mode.
     */
    swatch: "linear-gradient(135deg, oklch(1 0 0) 0 50%, oklch(0.1448 0 0) 50%)",
  },
  {
    id: "violet",
    name: "Violet",
    swatch: "oklch(0.526 0.247 293)",
  },
  {
    id: "emerald",
    name: "Emerald",
    swatch: "oklch(0.62 0.16 162)",
  },
  {
    id: "cobalt",
    name: "Cobalt",
    swatch: "oklch(0.585 0.2 254)",
  },
  {
    id: "amber",
    name: "Amber",
    swatch: "oklch(0.745 0.16 65)",
  },
  {
    id: "rose",
    name: "Rose",
    swatch: "oklch(0.645 0.22 16)",
  },
];

export function isThemeId(value: unknown): value is ThemeId {
  return (
    typeof value === "string" &&
    (THEME_IDS as ReadonlyArray<string>).includes(value)
  );
}
