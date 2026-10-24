// Role-based institute theme, stored under the THEME_SETTING key in the
// institute's settings JSON (see admin_core_service SettingKeyEnums).
// Brand keeps flowing through the existing institute_theme_code / theme.json
// path unchanged.
export const THEME_ROLE_SETTINGS_KEY = 'themeRoleSettings';

export interface NavRoleColors {
    surface: string;
    surfaceHover: string;
    active: string;
    activeText: string;
    text: string;
}

export interface ThemeRoleSettings {
    version?: number;
    mode?: 'preset' | 'custom' | 'legacy';
    roles?: {
        nav?: NavRoleColors;
        // Single base hex each — the 50-500 ramp is generated from it in the
        // learner app (theme-provider.tsx). Admin has no secondary-*/
        // tertiary-* tokens of its own (see this app's CLAUDE.md — they're a
        // learner-only extra), so this dialog only *saves* these values; it
        // never renders with them.
        secondary?: string;
        tertiary?: string;
        // Page canvas (--background), which is white in both apps by default.
        // Institutes with a light brand tint (cream, pale blue…) set it here.
        // Cards/sheets stay white so they keep reading as raised surfaces —
        // this only repaints the canvas behind them. Applies to BOTH apps.
        // Expected to be a light tint: --foreground stays dark, so a dark
        // value would break text contrast (the picker warns about this).
        background?: string;
        // Institute font (a curated family key resolved via resolveFontStack,
        // e.g. 'Lexend'). Applied as --app-font-family across both apps +
        // public pages. Absent = each app keeps its bundled default.
        fontFamily?: string;

        // ---- Learner presentation axes ------------------------------------
        // Applied in the learner app as data-ui-* attributes on <html>; the
        // token flips live in that app's styles/ui-axes.css. Like
        // secondary/tertiary above, this dialog only *saves* them — the admin
        // dashboard's own chrome deliberately does not ride these axes, since
        // an operator's tooling shouldn't reshape itself because a tenant
        // picked "pill".
        //
        // Each axis's default reproduces the learner app's current look, so an
        // absent value is a no-op rather than a regression. Keep the unions in
        // step with frontend-learner-dashboard-app/src/types/theme-role-settings.ts.

        /** Card padding, stack/section rhythm, control height. Default 'default'. */
        density?: UiDensity;
        /** Corner radius seed (--radius). rounded-full is exempt. Default 'rounded'. */
        corners?: UiCorners;
        /** Strength of brand surface gradients. Default 'full'. */
        gradient?: UiGradient;

        // ---- Learner UI skin ----------------------------------------------
        // Migrated here from STUDENT_DISPLAY_SETTINGS.ui.type so that every
        // "how the learner app looks" control lives in one settings blob.
        // The learner app reads THEME_SETTING first and falls back to the old
        // location, so institutes saved before this move keep their skin.
        skin?: StudentUiType;
    };
}

export type UiDensity = 'compact' | 'default' | 'comfortable';
export type UiCorners = 'sharp' | 'rounded' | 'pill';
export type UiGradient = 'flat' | 'subtle' | 'full';

/** Mirrors StudentUiType in types/student-display-settings.ts. */
export type StudentUiType = 'default' | 'vibrant' | 'play' | 'cleanerPlay' | 'corporate';

/** What each axis falls back to when the institute has saved nothing. */
export const UI_AXIS_DEFAULTS = {
    density: 'default',
    corners: 'rounded',
    gradient: 'full',
    skin: 'default',
} as const satisfies {
    density: UiDensity;
    corners: UiCorners;
    gradient: UiGradient;
    skin: StudentUiType;
};
