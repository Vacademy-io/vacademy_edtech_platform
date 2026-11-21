/**
 * Applies only the institute's primary ramp, not the whole ThemeProvider. A theme
 * code is a preset from theme.json or a custom "#hex", the same two cases
 * providers/theme/theme-provider.tsx handles.
 */
import convert from 'color-convert';
import themeData from '@/constants/themes/theme.json';
import { hslVar, rampFromHsl, SHADES } from '@/lib/theme-ramp';

type Triple = [number, number, number];

export function primaryRamp(code: string | null | undefined): Record<string, Triple> | null {
    const value = (code ?? '').trim();
    if (!value) return null;
    try {
        const preset = themeData.themes.find((theme) => theme.code === value);
        if (preset) {
            const colors = preset.colors as Record<string, string>;
            const out: Record<string, Triple> = {};
            for (const shade of SHADES) {
                const hex = colors[`primary-${shade}`];
                if (!hex) return null;
                out[shade] = convert.hex.hsl(hex.replace('#', ''));
            }
            return out;
        }
        if (/^#[0-9a-f]{6}$/i.test(value)) {
            const [h, s, l] = convert.hex.hsl(value.slice(1));
            return rampFromHsl(h, s, l);
        }
    } catch {
        return null;
    }
    return null;
}

export function applyTheme(code: string | null | undefined): void {
    const ramp = primaryRamp(code);
    const base = ramp?.['500'];
    if (!ramp || !base) return;
    const style = document.documentElement.style;
    style.setProperty('--primary', hslVar(base));
    style.setProperty('--primary-foreground', base[2] > 60 ? '222.2 47.4% 11.2%' : '210 40% 98%');
    for (const shade of SHADES) {
        const value = ramp[shade];
        if (value) style.setProperty(`--primary-${shade}`, hslVar(value));
    }
}
