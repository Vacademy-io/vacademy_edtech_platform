/**
 * The institute's brand shades as hex strings, for canvas drawing (confetti)
 * where CSS variables cannot be used. Read from the theme's `--primary-*`
 * variables ("H S% L%"); empty when they are missing, so callers fall back to
 * their own palette.
 */
const SHADES = ["--primary-300", "--primary-400", "--primary-500", "--primary-200"];

const toHex = (n: number) => Math.round(n * 255).toString(16).padStart(2, "0");

/** "24 85% 54%" → hex, or null when the value is not an HSL triplet. */
export const hslTripletToHex = (value: string): string | null => {
  const match = value.trim().match(/^(-?[\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%$/);
  if (!match) return null;
  const h = (((Number(match[1]) % 360) + 360) % 360) / 360;
  const s = Math.min(1, Number(match[2]) / 100);
  const l = Math.min(1, Number(match[3]) / 100);
  if (s === 0) return `#${toHex(l)}${toHex(l)}${toHex(l)}`;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return `#${toHex(channel(h + 1 / 3))}${toHex(channel(h))}${toHex(channel(h - 1 / 3))}`;
};

export const brandConfettiColors = (): string[] => {
  if (typeof window === "undefined" || typeof document === "undefined") return [];
  try {
    const style = getComputedStyle(document.documentElement);
    return SHADES.map((name) => hslTripletToHex(style.getPropertyValue(name))).filter(
      (c): c is string => !!c,
    );
  } catch {
    return [];
  }
};
