/**
 * Opt-in site palette + content width (globalSettings.theme.palette /
 * globalSettings.theme.contentMaxWidth). Pure; no React.
 *
 * A site without either setting gets NOTHING from here: every builder returns
 * an empty object / undefined, and the page wrappers keep their exact style.
 *
 * PALETTE → CSS variables on the page's theme wrapper (CourseCataloguePage,
 * CourseSubPage, CatalogueChrome, CourseDetailsPage):
 *   --palette-<name>: "H S% L%" channels, one per named colour that is set.
 *   Read them through the Tailwind `palette` colours (tailwind.config.js):
 *     text-palette-text, bg-palette-sand, border-palette-border-strong,
 *     bg-palette-olive/90 …
 *   Each falls back to a catalogue token when the site has no palette, so a
 *   component that uses them still renders sensibly on any other site.
 *   With `applyToTokens: true` the palette also re-points the shared catalogue
 *   tokens (text/bg/border) so existing components follow it — light mode only.
 *
 * CONTENT WIDTH (px of content, gutters excluded) →
 *   --site-content-max: <n>px
 *   --catalogue-content-max: <n + 64>px   (so every `.catalogue-shell` — whose
 *   max-width includes its lg 32px gutters — has exactly <n>px of content)
 */

export const PALETTE_KEYS = [
  "text",
  "body",
  "muted",
  "muted2",
  "primary",
  "gold",
  "accent",
  "olive",
  "cream",
  "canvas",
  "sand",
  "border",
  "borderStrong",
  // Feature "chrome": copy and lines on dark bands, outlined buttons.
  "accentOnDark",
  "bodyOnDark",
  "outline",
] as const;

export type PaletteKey = (typeof PALETTE_KEYS)[number];

/** globalSettings.theme.palette — hex colours (#rgb / #rrggbb). Anything else is ignored. */
export type SitePalette = Partial<Record<PaletteKey, string>> & {
  /** Also re-point the shared catalogue tokens (text/bg/border) at the palette. Light mode only. */
  applyToTokens?: boolean;
};

/** globalSettings.theme (the fields this module reads; the rest stay untyped as before). */
export interface CatalogueThemeSettings {
  preset?: string;
  primaryColor?: string;
  palette?: SitePalette;
  /** Content column width in px, gutters excluded (e.g. 1152). 320–2400; anything else is ignored. */
  contentMaxWidth?: number;
  [key: string]: unknown;
}

/** "--palette-border-strong" for "borderStrong". */
export const paletteVarName = (key: PaletteKey): string =>
  `--palette-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

/** The catalogue token each palette colour stands in for when the site has no palette. */
export const PALETTE_FALLBACK_TOKEN: Record<PaletteKey, string> = {
  text: "--catalogue-text-primary",
  body: "--catalogue-text-secondary",
  muted: "--catalogue-text-muted",
  muted2: "--catalogue-text-muted",
  primary: "--primary-500",
  gold: "--primary-500",
  accent: "--primary-400",
  olive: "--primary-500",
  cream: "--catalogue-bg-subtle",
  canvas: "--catalogue-bg",
  sand: "--catalogue-bg-muted",
  border: "--catalogue-border",
  borderStrong: "--catalogue-border-strong",
  accentOnDark: "--primary-200",
  bodyOnDark: "--catalogue-bg-muted",
  outline: "--catalogue-border-strong",
};

/** Shared catalogue tokens re-pointed by `applyToTokens` (light mode only). */
const TOKEN_TARGETS: Partial<Record<PaletteKey, string[]>> = {
  text: ["--catalogue-text-primary"],
  body: ["--catalogue-text-secondary"],
  muted: ["--catalogue-text-muted"],
  canvas: ["--catalogue-bg"],
  cream: ["--catalogue-bg-subtle"],
  sand: ["--catalogue-bg-muted"],
  border: ["--catalogue-border", "--catalogue-border-subtle"],
  borderStrong: ["--catalogue-border-strong"],
};

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** A hex colour → "H S% L%" (the channel form every catalogue colour var uses); null when not hex. */
export const hexToHslChannels = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!HEX.test(value)) return null;
  const hex =
    value.length === 4
      ? value
          .slice(1)
          .split("")
          .map((c) => c + c)
          .join("")
      : value.slice(1);
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return `${round1(h * 360)} ${round1(s * 100)}% ${round1(l * 100)}%`;
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/**
 * CSS variables for a palette. {} when the palette is absent or holds no
 * valid colour. In dark mode only the --palette-* vars are set (the shared
 * tokens keep their dark values).
 */
export const buildPaletteVars = (
  palette: unknown,
  opts: { mode?: string | null } = {},
): Record<string, string> => {
  if (!isObject(palette)) return {};
  const out: Record<string, string> = {};
  const repoint = palette.applyToTokens === true && opts.mode !== "dark";
  for (const key of PALETTE_KEYS) {
    const channels = hexToHslChannels(palette[key]);
    if (!channels) continue;
    out[paletteVarName(key)] = channels;
    if (repoint) for (const token of TOKEN_TARGETS[key] ?? []) out[token] = channels;
  }
  return out;
};

/** A content width in px (integer 320–2400), else null. */
export const resolveContentMaxWidth = (raw: unknown): number | null => {
  const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const px = Math.round(n);
  return px >= 320 && px <= 2400 ? px : null;
};

/** The `.catalogue-shell` gutters at lg (2 × --space-8). */
export const SHELL_GUTTERS_PX = 64;

/** Vars that give every `.catalogue-shell` (and the catalog's own container) exactly `px` of content. */
export const buildContentWidthVars = (px: number | null): Record<string, string> =>
  px === null
    ? {}
    : {
        "--site-content-max": `${px}px`,
        "--catalogue-content-max": `${px + SHELL_GUTTERS_PX}px`,
      };

/**
 * Every theme var this module contributes for a site (palette + content
 * width), or undefined when the site sets neither — callers then keep their
 * style exactly as before.
 */
export const buildSiteThemeVars = (
  globalSettings: { theme?: unknown; mode?: unknown } | null | undefined,
): Record<string, string> | undefined => {
  const theme = isObject(globalSettings?.theme) ? globalSettings!.theme : undefined;
  if (!theme) return undefined;
  const vars = {
    ...buildPaletteVars(theme.palette, { mode: typeof globalSettings?.mode === "string" ? globalSettings.mode : null }),
    ...buildContentWidthVars(resolveContentMaxWidth(theme.contentMaxWidth)),
  };
  return Object.keys(vars).length ? vars : undefined;
};

/**
 * A wrapper style with the site theme vars merged in. Returns `base` itself
 * (same object, same keys) when the site sets no palette or width, so the
 * rendered style attribute is unchanged for every other site.
 */
export const withSiteThemeVars = <T extends object | undefined>(
  base: T,
  globalSettings: { theme?: unknown; mode?: unknown } | null | undefined,
): T | (T & Record<string, string>) => {
  const vars = buildSiteThemeVars(globalSettings);
  return vars ? ({ ...(base ?? {}), ...vars } as T & Record<string, string>) : base;
};
