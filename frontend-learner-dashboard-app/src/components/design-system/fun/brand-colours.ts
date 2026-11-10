import { contrastRatio, hexToRgb, mixHex, readableBrand, rgbToHex } from "@/lib/colour/contrast";

/**
 * The institute's brand as the Fun skin uses it: only for the main call to action,
 * the active nav item and links. Course content uses course colours instead.
 *
 *   tint  = brand 88% toward white            (nav pill, avatar)
 *   solid = brand toward DARKEN in 4% steps, at most 60%, until it reads at 4.5:1
 *           on the tint, so white on solid and solid on tint (and on white) all pass
 *   lip   = solid 35% toward DARKEN            (the button's lip)
 *
 * The same rule the design boards draw with (renderVals in Main.dc.html).
 */
const WHITE = "#ffffff"; // design-lint-ignore: mixing target
const DARKEN = "#111827"; // design-lint-ignore: mixing target

export const BRAND_TEXT_CONTRAST = 4.5;
const TINT_TOWARD_WHITE = 0.88;
const SOLID_STEP = 0.04;
const SOLID_MAX = 0.6;
const LIP_TOWARD_DARK = 0.35;

export interface FunBrandColours {
  solid: string;
  tint: string;
  lip: string;
}

export function funBrandColours(brandHex: string | null | undefined): FunBrandColours | null {
  const rgb = hexToRgb(brandHex);
  if (!rgb) return null;
  const brand = rgbToHex(rgb);
  const tint = mixHex(brand, WHITE, TINT_TOWARD_WHITE)!;
  let solid = brand;
  let t = 0;
  while (contrastRatio(solid, tint) < BRAND_TEXT_CONTRAST && t < SOLID_MAX) {
    t += SOLID_STEP;
    solid = mixHex(brand, DARKEN, t)!;
  }
  // A brand so pale that 60% is not enough (white, a pale yellow) keeps going.
  if (contrastRatio(solid, tint) < BRAND_TEXT_CONTRAST) solid = readableBrand(solid, tint, BRAND_TEXT_CONTRAST);
  return { solid, tint, lip: mixHex(solid, DARKEN, LIP_TOWARD_DARK)! };
}

/** The live red (--fun-live in styles/fun/base.css). Keep the two in step. */
export const FUN_LIVE_RED = "#e11d48"; // design-lint-ignore: mirrors a token
const NEAR_LIVE_HUE_DEGREES = 25;
const NEAR_LIVE_MIN_SATURATION = 0.3;

function hueAndSaturation(hex: string): { hue: number; saturation: number } | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((channel) => channel / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  if (delta === 0) return { hue: 0, saturation: 0 };
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  const hue =
    max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { hue: (hue * 60 + 360) % 360, saturation };
}

/**
 * True when the brand reads as the same red or rose as a live class's Join button,
 * so a card showing both must not tell them apart by colour alone.
 */
export function brandNearLiveRed(brandHex: string | null | undefined): boolean {
  const brand = brandHex ? hueAndSaturation(brandHex) : null;
  const live = hueAndSaturation(FUN_LIVE_RED);
  if (!brand || !live || brand.saturation < NEAR_LIVE_MIN_SATURATION) return false;
  const apart = Math.abs(brand.hue - live.hue);
  return Math.min(apart, 360 - apart) <= NEAR_LIVE_HUE_DEGREES;
}
