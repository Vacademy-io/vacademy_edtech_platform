// Role-based institute theme, stored under the THEME_SETTING key in the
// institute's settings JSON (see admin_core_service SettingKeyEnums).
// Brand keeps flowing through the existing institute_theme_code / theme.json
// path unchanged.
export const THEME_ROLE_SETTINGS_KEY = "themeRoleSettings";

export interface NavRoleColors {
  surface: string;
  surfaceHover: string;
  active: string;
  activeText: string;
  text: string;
}

export interface ThemeRoleSettings {
  version?: number;
  mode?: "preset" | "custom" | "legacy";
  roles?: {
    nav?: NavRoleColors;
    // Single base hex each — the 50-500 ramp is generated from it (same
    // formula as brand). Learner-app-only: these tokens don't exist in the
    // admin dashboard (see its CLAUDE.md — secondary-*/tertiary-* are a
    // learner extra), so setting these has no visual effect there.
    secondary?: string;
    tertiary?: string;
    // Page canvas (--background), which is white in both apps by default.
    // Institutes with a light brand tint (cream, pale blue…) set it here.
    // Cards/sheets stay white so they keep reading as raised surfaces —
    // this only repaints the canvas behind them. Applies to BOTH apps.
    // Expected to be a light tint: the app's --foreground stays dark, so a
    // dark value here would break text contrast (the admin picker warns).
    background?: string;
    // Institute font (a curated family key resolved via resolveFontStack,
    // e.g. "Lexend"). Applied as --app-font-family across both apps + public
    // pages. Absent = each app keeps its bundled default.
    fontFamily?: string;

    // ---- Presentation axes (learner app) ----------------------------------
    // Applied as data-ui-* attributes on <html>; the token flips live in
    // styles/ui-axes.css. Each axis's default reproduces today's look exactly,
    // so an absent value is a no-op rather than a regression.
    //
    // Learner-app-only, like secondary/tertiary: the admin dashboard's own
    // chrome deliberately does not ride these (an admin's tooling shouldn't
    // reshape itself because a tenant picked "pill"). The admin WRITES them.

    /** Card padding, stack/section rhythm and control height. Default "default". */
    density?: UiDensity;
    /** Corner radius seed (--radius). rounded-full is exempt. Default "rounded". */
    corners?: UiCorners;
    /** Strength of brand surface gradients. Default "full". */
    gradient?: UiGradient;

    /**
     * Learner UI skin, migrated here from STUDENT_DISPLAY_SETTINGS.ui.type so
     * that every "how the learner app looks" control lives in one blob.
     *
     * READ ORDER MATTERS: resolveUiSkin() prefers this field and falls back to
     * ui.type, because ~every institute configured before the move still has
     * its skin only in the old location. Never read this field bare.
     */
    skin?: StudentUiTypeMirror;
  };
}

/**
 * Structural mirror of StudentUIType in types/student-display-settings.ts.
 * Duplicated rather than imported to keep this file dependency-free — it is
 * read by utils/institute-theme-roles.ts on the public/pre-login path, which
 * must not pull in the student-display-settings module graph.
 */
export type StudentUiTypeMirror =
  | "default"
  | "vibrant"
  | "play"
  | "cleanerPlay"
  | "corporate";

export type UiDensity = "compact" | "default" | "comfortable";
export type UiCorners = "sharp" | "rounded" | "pill";
export type UiGradient = "flat" | "subtle" | "full";

export const UI_DENSITY_VALUES: readonly UiDensity[] = [
  "compact",
  "default",
  "comfortable",
];
export const UI_CORNERS_VALUES: readonly UiCorners[] = [
  "sharp",
  "rounded",
  "pill",
];
export const UI_GRADIENT_VALUES: readonly UiGradient[] = [
  "flat",
  "subtle",
  "full",
];

/** What each axis falls back to when the institute has saved nothing. */
export const UI_AXIS_DEFAULTS = {
  density: "default",
  corners: "rounded",
  gradient: "full",
} as const satisfies {
  density: UiDensity;
  corners: UiCorners;
  gradient: UiGradient;
};
