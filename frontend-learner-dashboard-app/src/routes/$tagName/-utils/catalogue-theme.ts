import { resolveThemeHex } from "@/services/domain-routing";
import { buildPrimaryScaleVars } from "./style-utils";

/**
 * Scope a catalogue's `theme.primaryColor` onto one element as CSS custom
 * properties, so everything inside it (including shadcn `bg-primary`) paints
 * the institute's colour instead of the global ThemeProvider default — which
 * can be a stale `theme-custom-color` cached in localStorage.
 *
 * Extracted verbatim from the identical blocks in CourseCataloguePage and
 * CourseDetailsPage so new surfaces (the product page) share one definition
 * rather than growing a third copy. Those two predate this helper and still
 * carry their own inline copy; behaviour here is byte-for-byte the same.
 */
export const applyCataloguePrimaryColor = (
  el: HTMLElement | null,
  primaryColor?: string,
): void => {
  if (!el) return;

  const vars = ["--primary-500", "--primary", "--primary-400", "--primary-200", "--primary-50"];

  if (!primaryColor || !/^#[0-9a-fA-F]{6}$/.test(primaryColor)) {
    vars.forEach((v) => el.style.removeProperty(v));
    return;
  }

  const r = parseInt(primaryColor.slice(1, 3), 16) / 255;
  const g = parseInt(primaryColor.slice(3, 5), 16) / 255;
  const b = parseInt(primaryColor.slice(5, 7), 16) / 255;
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
  const H = Math.round(h * 360);
  const S = Math.round(s * 100);
  const L = Math.round(l * 100);

  el.style.setProperty("--primary-500", `${H} ${S}% ${L}%`);
  // Keep the shadcn base `--primary` in sync with --primary-500: the header
  // Login button and other `bg-primary` elements read hsl(var(--primary)).
  el.style.setProperty("--primary", `${H} ${S}% ${L}%`);
  el.style.setProperty("--primary-400", `${H} ${S}% ${Math.min(L + 10, 90)}%`);
  el.style.setProperty("--primary-200", `${H} ${Math.max(S - 15, 10)}% ${Math.min(L + 28, 95)}%`);
  el.style.setProperty("--primary-50", `${H} ${Math.max(S - 30, 5)}% ${Math.min(L + 43, 98)}%`);
};

/** The theme every institute without one of its own is shown in. */
const DEFAULT_THEME_CODE = "primary";

/**
 * The primary scale a site's wrapper carries as inline variables.
 *
 * A signed-in learner of another institute keeps their own colours on the
 * document, so nothing may fall through to it: they get every stop, `--primary`
 * included, from the site's colour or else its institute's theme. Everyone else
 * has the institute's theme on the document, and only a site colour to add.
 */
export const siteScaleVars = (
  primaryColor?: string | null,
  isVisitor?: boolean,
  instituteThemeCode?: string | null,
): Record<string, string> => {
  const siteScale = buildPrimaryScaleVars(primaryColor);
  if (!isVisitor) return siteScale;
  const scale = siteScale["--primary-500"]
    ? siteScale
    : buildPrimaryScaleVars(
        resolveThemeHex(instituteThemeCode) ?? resolveThemeHex(DEFAULT_THEME_CODE),
      );
  return scale["--primary-500"] ? { ...scale, "--primary": scale["--primary-500"] } : scale;
};
