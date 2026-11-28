/**
 * Colour maths for skins that draw their own filled controls: WCAG 2.x contrast,
 * mixing, and reading the brand the theme provider writes. No React and no DOM.
 *
 * The app-wide button colours and the global primary-foreground rule do not use
 * this; a skin reaches for it only for the controls it draws itself.
 */

export type Rgb = [number, number, number];

/** What a brand is darkened toward when it needs more contrast. */
const INK = "#1e2229"; // design-lint-ignore: darkening target, not a UI colour

const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;

export function hexToRgb(hex: string | null | undefined): Rgb | null {
  const match = HEX.exec((hex ?? "").trim());
  if (!match) return null;
  let value = match[1]!;
  if (value.length === 3) value = value.replace(/./g, (c) => c + c);
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

const clampByte = (value: number) => Math.round(Math.max(0, Math.min(255, value)));

export function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((v) => clampByte(v).toString(16).padStart(2, "0")).join("")}`;
}

/** `a` moved toward `b` by `t` (0..1), each channel rounded. Null when either is unreadable. */
export function mixHex(a: string, b: string, t: number): string | null {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  if (!x || !y) return null;
  return rgbToHex([
    x[0] * (1 - t) + y[0] * t,
    x[1] * (1 - t) + y[1] * t,
    x[2] * (1 - t) + y[2] * t,
  ]);
}

function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  const h = (((hue % 360) + 360) % 360) / 60;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs((h % 2) - 1));
  const m = lightness - chroma / 2;
  const table: Rgb[] = [
    [chroma, x, 0],
    [x, chroma, 0],
    [0, chroma, x],
    [0, x, chroma],
    [x, 0, chroma],
    [chroma, 0, x],
  ];
  const [r, g, b] = table[Math.floor(h) % 6]!;
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/**
 * Reads the value of --primary-500 ("221 83% 53%", commas allowed), the form the
 * theme provider writes. Returns null for anything else.
 */
export function hslChannelsToHex(value: string | null | undefined): string | null {
  const match = /^\s*(-?[\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/.exec(value ?? "");
  if (!match) return null;
  return rgbToHex(hslToRgb(Number(match[1]), Number(match[2]) / 100, Number(match[3]) / 100));
}

export function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio. Unreadable input counts as no contrast. */
export function contrastRatio(a: string, b: string): number {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  if (!x || !y) return 1;
  const lx = relativeLuminance(x);
  const ly = relativeLuminance(y);
  return (Math.max(lx, ly) + 0.05) / (Math.min(lx, ly) + 0.05);
}

/**
 * The brand exactly as it is when it already reads at `target` against `ground`,
 * otherwise darkened from it only as far as it takes. A pale brand (amber, sky)
 * gets a deeper shade of its own hue instead of an unreadable fill.
 */
export function readableBrand(
  brandHex: string | null | undefined,
  ground: string,
  target: number,
): string {
  const start = hexToRgb(brandHex) ? rgbToHex(hexToRgb(brandHex)!) : null;
  if (!start) return INK;
  for (let t = 0; t <= 1.001; t += 0.02) {
    const candidate = t === 0 ? start : mixHex(start, INK, Math.min(t, 1))!;
    if (contrastRatio(candidate, ground) >= target) return candidate;
  }
  return INK;
}
