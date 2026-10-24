import convert from "color-convert";
import { hslVar } from "@/lib/theme-ramp";
import { resolveFontStack } from "@/utils/branding";
import {
  THEME_ROLE_SETTINGS_KEY,
  UI_CORNERS_VALUES,
  UI_DENSITY_VALUES,
  UI_GRADIENT_VALUES,
  type StudentUiTypeMirror,
  type ThemeRoleSettings,
} from "@/types/theme-role-settings";

/**
 * Role-based theme (nav / secondary / tertiary / background) plumbing that has
 * to work on BOTH the logged-in path and the public/no-login pages (enroll-by-
 * invite, custom-domain landing, product pages).
 *
 * The logged-in path caches THEME_SETTING into localStorage via
 * fetchAndStoreInstituteDetails, and the ThemeProvider reads it from there. The
 * public pages never call that fetch — they get institute data from the public
 * endpoints — so without this helper their canvas/background role is simply
 * never loaded, and an institute-set page background silently doesn't render.
 */

/** Parse the current cached role settings, if any. */
export function readThemeRoleSettings(): ThemeRoleSettings | null {
  try {
    const raw = localStorage.getItem(THEME_ROLE_SETTINGS_KEY);
    return raw ? (JSON.parse(raw) as ThemeRoleSettings) : null;
  } catch {
    return null;
  }
}

/**
 * Extract THEME_SETTING.data out of an institute's settings JSON (the
 * `institute_settings_json` / public `setting` field, string or object) and
 * cache it into localStorage under THEME_ROLE_SETTINGS_KEY — the exact shape
 * and key the ThemeProvider already reads. Clears the key when there are no
 * roles, so switching to an institute without an override doesn't inherit the
 * previous one. Returns the parsed settings for convenience.
 */
export function syncThemeRoleSettingsFromSettingJson(
  settingJson: unknown
): ThemeRoleSettings | null {
  try {
    const parsed =
      typeof settingJson === "string"
        ? settingJson
          ? JSON.parse(settingJson)
          : null
        : settingJson;
    const data: ThemeRoleSettings | undefined =
      parsed?.setting?.THEME_SETTING?.data;
    if (data?.roles && Object.keys(data.roles).length > 0) {
      localStorage.setItem(THEME_ROLE_SETTINGS_KEY, JSON.stringify(data));
      return data;
    }
    localStorage.removeItem(THEME_ROLE_SETTINGS_KEY);
    return data ?? null;
  } catch {
    return null;
  }
}

/**
 * Apply the institute-authored page background (THEME_SETTING `background`
 * role) to the document. Repaints the canvas only — --card stays white, so
 * cards keep reading as raised surfaces on a tinted page. Inline custom
 * properties outrank the stylesheet, so this also wins over
 * cleaner-play-theme.css's forced white; --cp-bg is set too so that skin's
 * canvas rule follows along. Removing the value falls back to the stylesheet
 * default (white).
 */
export function applyInstituteBackground(): void {
  const background = readThemeRoleSettings()?.roles?.background;
  const root = document.documentElement;
  if (!background) {
    root.style.removeProperty("--background");
    root.style.removeProperty("--canvas");
    root.style.removeProperty("--cp-bg");
    return;
  }
  try {
    const [h, s, l] = convert.hex.hsl(background.replace("#", ""));
    const value = hslVar([h, s, l]);
    root.style.setProperty("--background", value);
    // --canvas too: a skin may tint the canvas (Corporate does), and an
    // institute's explicit page background has to win over a skin default.
    // Inline beats the stylesheet, so writing it here restores that precedence.
    root.style.setProperty("--canvas", value);
    root.style.setProperty("--cp-bg", value);
  } catch {
    // ignore malformed institute-authored hex
  }
}

/**
 * Apply the institute-authored font (THEME_SETTING `fontFamily` role) as
 * --app-font-family + body font. Runs the same resolveFontStack the rest of
 * the app uses (curated key -> full stack, Arabic fallback preserved). When no
 * font role is set this is a no-op — whatever applyTabBranding / the app
 * default already set stays, so this never regresses non-configured institutes.
 */
export function applyInstituteFont(): void {
  const fontFamily = readThemeRoleSettings()?.roles?.fontFamily;
  if (!fontFamily) return;
  try {
    const stack = resolveFontStack(fontFamily);
    document.documentElement.style.setProperty("--app-font-family", stack);
    document.body.style.fontFamily = stack;
  } catch {
    // ignore malformed institute-authored font
  }
}

/**
 * Apply the institute-authored presentation axes (THEME_SETTING `density` /
 * `corners` / `gradient` roles) as data-ui-* attributes on <html>. The token
 * flips themselves live in styles/ui-axes.css.
 *
 * Attributes rather than inline custom properties on purpose: the axes each
 * move several tokens at once, and theme-provider already writes --primary-*
 * and --background inline. An inline declaration outranks any stylesheet rule,
 * so writing the axis tokens inline here would silently win over an
 * institute's --background/--radius work and, worse, could not be undone by a
 * later stylesheet. Attributes keep the cascade intact and let
 * applyInstituteBackground's inline --background continue to override the
 * axis-set canvas, which is the precedence we want.
 *
 * Unknown/absent values fall back to the documented default for that axis, so
 * a malformed or partially-saved blob degrades to today's look rather than to
 * an unstyled one.
 */
export function applyInstituteUiAxes(): void {
  const roles = readThemeRoleSettings()?.roles;
  const root = document.documentElement;

  // Write an axis attribute ONLY when the institute actually chose that axis.
  //
  // An always-present attribute would make "institute picked the default" and
  // "institute never opened the Appearance tab" indistinguishable in CSS, and a
  // skin could then never supply its own house defaults — the Corporate skin
  // proposes 10px corners and a tinted canvas out of the box, but must still
  // lose to an institute that explicitly picked "sharp".
  //
  // Omitting the attribute falls through to :root, whose values are identical to
  // the documented defaults, so this is a no-op for every institute that has not
  // set an axis. Where the attribute IS present it beats the skin's defaults,
  // because styles/ui-axes.css is imported after the skin stylesheets and the two
  // selectors have equal specificity.
  const setOrClear = <T extends string>(
    attr: string,
    value: unknown,
    allowed: readonly T[]
  ) => {
    if (allowed.includes(value as T)) root.setAttribute(attr, value as string);
    else root.removeAttribute(attr);
  };

  setOrClear("data-ui-density", roles?.density, UI_DENSITY_VALUES);
  setOrClear("data-ui-corners", roles?.corners, UI_CORNERS_VALUES);
  setOrClear("data-ui-gradient", roles?.gradient, UI_GRADIENT_VALUES);
}

/**
 * Resolve the learner UI skin, preferring the new THEME_SETTING `skin` role
 * and falling back to the legacy STUDENT_DISPLAY_SETTINGS `ui.type`.
 *
 * The skin control moved from Student Display to the Appearance tab so that
 * every "how the learner app looks" setting lives in one blob. Institutes
 * configured before that move have their skin ONLY in ui.type, and there is no
 * migration job — so this fallback is load-bearing, not defensive. Reading
 * roles.skin bare would silently reset every already-configured institute to
 * the default skin.
 *
 * @param legacyUiType STUDENT_DISPLAY_SETTINGS.ui.type, if the caller has it.
 */
export function resolveUiSkin(
  legacyUiType?: StudentUiTypeMirror | null
): StudentUiTypeMirror {
  const allowed: readonly StudentUiTypeMirror[] = [
    "default",
    "vibrant",
    "play",
    "cleanerPlay",
    "corporate",
  ];
  const fromTheme = readThemeRoleSettings()?.roles?.skin;
  if (fromTheme && allowed.includes(fromTheme)) return fromTheme;
  if (legacyUiType && allowed.includes(legacyUiType)) return legacyUiType;
  return "default";
}
