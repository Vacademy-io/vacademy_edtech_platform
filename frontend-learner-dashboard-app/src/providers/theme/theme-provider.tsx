"use client";

import type React from "react";
import { createContext, useContext, useEffect, useState } from "react";
import convert from "color-convert";
import themeData from "@/constants/themes/theme.json";
import { HOLISTIC_INSTITUTE_ID } from "@/constants/urls";
import { getInstituteId } from "@/utils/study-library/get-list-from-stores/getPackageSessionId";
import {
  THEME_ROLE_SETTINGS_KEY,
  type NavRoleColors,
  type ThemeRoleSettings,
} from "@/types/theme-role-settings";
import { rampFromHsl, hslVar, SHADES } from "@/lib/theme-ramp";
import {
  applyInstituteBackground,
  applyInstituteFont,
  applyInstituteUiAxes,
} from "@/utils/institute-theme-roles";

// Generates a full 50-500 shade ramp around an arbitrary HSL base — same
// tint curve for every caller (primary, secondary, tertiary) and identical
// to the curve baked into the preset palettes. See lib/theme-ramp.ts for
// why this is a mix-toward-white rather than the older saturation-raising
// formula (it turned dark/saturated brands neon and greys pink).
const setShadeRamp = (prefix: string, hue: number, sat: number, light: number) => {
  const ramp = rampFromHsl(hue, sat, light);
  document.documentElement.style.setProperty(`--${prefix}`, hslVar(ramp["500"]));
  SHADES.forEach((shade) => {
    document.documentElement.style.setProperty(`--${prefix}-${shade}`, hslVar(ramp[shade]));
  });
};

// Institute-authored secondary/tertiary override (THEME_SETTING). Runs after
// whatever default (preset or hue-shift) already set --secondary-*/
// --tertiary-*, and replaces them with a ramp built directly from the
// chosen hex — no hue-shift, since the admin explicitly picked this color.
const applySecondaryTertiaryOverrides = () => {
  let secondary: string | undefined;
  let tertiary: string | undefined;
  try {
    const raw = localStorage.getItem(THEME_ROLE_SETTINGS_KEY);
    const parsed: ThemeRoleSettings | null = raw ? JSON.parse(raw) : null;
    secondary = parsed?.roles?.secondary;
    tertiary = parsed?.roles?.tertiary;
  } catch {
    secondary = undefined;
    tertiary = undefined;
  }

  const applyOne = (prefix: "secondary" | "tertiary", hex?: string) => {
    if (!hex) return;
    try {
      const [h, s, l] = convert.hex.hsl(hex.replace("#", ""));
      setShadeRamp(prefix, h, s, l);
    } catch {
      // ignore malformed institute-authored hex
    }
  };
  applyOne("secondary", secondary);
  applyOne("tertiary", tertiary);
};

// Applies the `nav` role (sidebar/rail surface, hover, active, active-text,
// text) from institute settings if one has been saved (THEME_SETTING). With
// no override, the default REPRODUCES the sidebar's current hardcoded look
// (white surface, primary-50 tinted active state, primary-500 active text —
// see non-collapsible-item.tsx / collapsible-item.tsx) so that wiring a
// component onto --nav-* is a no-op for every institute until they actually
// opt into a different nav (e.g. a dark rail) via a saved THEME_SETTING.
const applyNavRoles = (h: number, s: number, l: number) => {
  const setHSL = (cssVar: string, hue: number, sat: number, light: number) => {
    const wrap = (deg: number) => ((deg % 360) + 360) % 360;
    document.documentElement.style.setProperty(cssVar, `${wrap(hue)} ${sat}% ${light}%`);
  };

  let nav: NavRoleColors | undefined;
  try {
    const raw = localStorage.getItem(THEME_ROLE_SETTINGS_KEY);
    const parsed: ThemeRoleSettings | null = raw ? JSON.parse(raw) : null;
    nav = parsed?.roles?.nav;
  } catch {
    nav = undefined;
  }

  if (nav) {
    const setFromHex = (cssVar: string, hex: string) => {
      try {
        const [hh, ss, ll] = convert.hex.hsl(hex.replace("#", ""));
        setHSL(cssVar, hh, ss, ll);
      } catch {
        // ignore malformed institute-authored hex
      }
    };
    setFromHex("--nav-surface", nav.surface);
    setFromHex("--nav-surface-hover", nav.surfaceHover);
    setFromHex("--nav-active", nav.active);
    setFromHex("--nav-active-text", nav.activeText);
    setFromHex("--nav-text", nav.text);
    return;
  }

  // Legacy default: white surface, primary-50 tinted active pill,
  // primary-500 active text — pixel-equivalent to today's hardcoded classes.
  setHSL("--nav-surface", 0, 0, 100);
  setHSL("--nav-surface-hover", 210, 40, 96); // matches shadcn --muted, not hue-tinted (today's hover:bg-muted/60)
  const [a50h, a50s, a50l] = rampFromHsl(h, s, l)["50"];
  setHSL("--nav-active", a50h, a50s, a50l); // == primary-50
  setHSL("--nav-active-text", h, s, l); // == primary-500
  setHSL("--nav-text", 222.2, 84, 4.9); // == --foreground exactly (today's inherited default)
};

type ThemeContextType = {
  primaryColor: string;
  setPrimaryColor: (color: string) => void;
  getPrimaryColorCode: () => string;
};

const ThemeContext = createContext<ThemeContextType>({
  primaryColor: import.meta.env.VITE_DEFAULT_THEME_COLOR ?? "neutral",
  setPrimaryColor: () => {},
  getPrimaryColorCode: () => "#6B7280", // design-lint-ignore: theme default color
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [primaryColor, setPrimaryColor] = useState(
    import.meta.env.VITE_DEFAULT_THEME_COLOR ?? "neutral"
  );

  const getPrimaryColorCode = () => {
    const entry = themeData.themes.find((theme) => theme.code === primaryColor) as
      | { colors?: { primary?: Record<"500", string> } }
      | undefined;
    const hex = entry?.colors?.primary?.["500"];
    return hex || "#6B7280"; // design-lint-ignore: theme default color
  };

  // Apply CSS variables when primary color changes
  useEffect(() => {
    // Find the theme in our JSON data by code
    const theme = themeData.themes.find((t) => t.code === primaryColor);

    if (theme && theme.colors) {
      // If we found the theme in our JSON, use those exact colors as HSL values
      const setHSLFromHex = (cssVar: string, hexColor: string) => {
        try {
          const [h, s, l] = convert.hex.hsl(hexColor.replace("#", ""));
          document.documentElement.style.setProperty(
            cssVar,
            `${h} ${s}% ${l}%`
          );
        } catch (error) {
          console.error(
            `Error converting color ${hexColor} for ${cssVar}:`,
            error
          );
        }
      };

      // Support both nested (primary.{50..500}) and flat ("primary-50") shapes
      type Shade = "50" | "100" | "200" | "300" | "400" | "500";
      type Palette = Record<Shade, string>;
      type NestedColors = {
        primary: Palette;
        secondary?: Palette;
        tertiary?: Palette;
      };
      type FlatColors = Record<`${"primary" | "secondary" | "tertiary"}-${Shade}`, string>;
      type ThemeColors = NestedColors | FlatColors;

      const isRecord = (value: unknown): value is Record<string, unknown> =>
        value !== null && typeof value === "object";

      const isNestedColors = (value: unknown): value is NestedColors => {
        if (!isRecord(value)) return false;
        const p = (value as Record<string, unknown>)["primary"];
        if (!isRecord(p)) return false;
        return typeof (p as Record<string, unknown>)["500"] === "string";
      };

      const getColorHex = (
        category: "primary" | "secondary" | "tertiary",
        shade: Shade
      ): string | undefined => {
        const colors: ThemeColors = theme.colors as unknown as ThemeColors;
        if (isNestedColors(colors)) {
          const palette = colors[category];
          return palette ? palette[shade] : undefined;
        }
        const key = `${category}-${shade}` as const;
        return (colors as FlatColors)[key];
      };

      const shades: Array<"50" | "100" | "200" | "300" | "400" | "500"> = [
        "50",
        "100",
        "200",
        "300",
        "400",
        "500",
      ];

      // Primary palette
      const primary500 = getColorHex("primary", "500");
      if (primary500) {
        setHSLFromHex("--primary", primary500);
      }
      shades.forEach((shade) => {
        const hex = getColorHex("primary", shade);
        if (hex) setHSLFromHex(`--primary-${shade}`, hex);
      });

      // Set primary foreground based on the brightness of primary-500
      const [, , l] = convert.hex.hsl((primary500 || "#000000").replace("#", "")); // design-lint-ignore: theme default color
      document.documentElement.style.setProperty(
        "--primary-foreground",
        l > 60 ? "222.2 47.4% 11.2%" : "210 40% 98%"
      );

      // Secondary palette (for vibrant accents)
      shades.forEach((shade) => {
        const hex = getColorHex("secondary", shade);
        if (hex) setHSLFromHex(`--secondary-${shade}`, hex);
      });

      // Tertiary palette (for vibrant accents)
      shades.forEach((shade) => {
        const hex = getColorHex("tertiary", shade);
        if (hex) setHSLFromHex(`--tertiary-${shade}`, hex);
      });

      // Nav role (sidebar/rail) — explicit institute override or derived default.
      if (primary500) {
        const [ph, ps, pl] = convert.hex.hsl(primary500.replace("#", ""));
        applyNavRoles(ph, ps, pl);
      }
      // Institute-authored secondary/tertiary override, if any — replaces
      // the preset's bundled shades set above.
      applySecondaryTertiaryOverrides();
      // Institute-authored page canvas, if any.
      applyInstituteBackground();
      applyInstituteFont();
      applyInstituteUiAxes();

      // Store the theme selection
      localStorage.setItem("theme-code", primaryColor);
    } else if (primaryColor.startsWith("#")) {
      // Handle custom hex colors (for color picker)
      const [h, s, l] = convert.hex.hsl(primaryColor.replace("#", ""));

      // Primary: exact chosen hue.
      setShadeRamp("primary", h, s, l);
      document.documentElement.style.setProperty(
        "--primary-foreground",
        l > 60 ? "222.2 47.4% 11.2%" : "210 40% 98%"
      );

      // Secondary/tertiary: same relationship the hand-authored presets use
      // (an analogous, softer supporting hue in each direction) rather than
      // leaving them pinned to the static blue-gray/cream fallback in
      // index.css regardless of the institute's chosen brand color.
      setShadeRamp("secondary", h - 24, Math.max(s - 25, 20), Math.min(l + 15, 80));
      setShadeRamp("tertiary", h + 48, Math.max(s - 35, 15), Math.min(l + 25, 88));

      // Nav role (sidebar/rail) — explicit institute override or derived default.
      applyNavRoles(h, s, l);
      // Institute-authored secondary/tertiary override, if any — replaces
      // the hue-shifted defaults set above.
      applySecondaryTertiaryOverrides();
      // Institute-authored page canvas, if any.
      applyInstituteBackground();
      applyInstituteFont();
      applyInstituteUiAxes();

      // Store the custom color
      localStorage.setItem("theme-custom-color", primaryColor);
      localStorage.removeItem("theme-code");
    }
  }, [primaryColor]);

  useEffect(() => {
    const initializeTheme = async () => {
      const instituteId = await getInstituteId();
      // Check if institute ID matches and set holistic theme
      if (instituteId === HOLISTIC_INSTITUTE_ID) {
        setPrimaryColor("holistic");
        return;
      }
      const savedThemeCode = localStorage.getItem("theme-code");
      const savedCustomColor = localStorage.getItem("theme-custom-color");

      if (savedThemeCode) {
        setPrimaryColor(savedThemeCode);
      } else if (savedCustomColor) {
        setPrimaryColor(savedCustomColor);
      }
    };

    initializeTheme();
  }, []);

  return (
    <ThemeContext.Provider
      value={{ primaryColor, setPrimaryColor, getPrimaryColorCode }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
