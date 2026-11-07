import { useMemo } from 'react';

/**
 * Fixed colours for the learner and batch reports. Charts take literal colours (SVG attributes
 * and the PDF export cannot resolve CSS variables), so the brand colour is resolved once to hex.
 */
export const REPORT_COLORS = {
    good: '#16a34a',
    goodSoft: '#dcfce7',
    warn: '#f59e0b',
    warnSoft: '#fef3c7',
    bad: '#dc2626',
    badSoft: '#fee2e2',
    neutral: '#cbd5e1',
    classMark: '#334155',
    ink: '#1f2937',
    muted: '#6b7280',
    line: '#e5e7eb',
    paper: '#ffffff',
} as const;

/** Score bands shared by every report chart: 60% and above is good, under 40% is weak. */
export const scoreColor = (pct: number | null | undefined) =>
    pct == null
        ? REPORT_COLORS.neutral
        : pct >= 60
          ? REPORT_COLORS.good
          : pct >= 40
            ? REPORT_COLORS.warn
            : REPORT_COLORS.bad;

const HEX = /^#[0-9a-f]{6}$/i;
const FALLBACK_BRAND = '#4f46e5';

const hslToHex = (h: number, s: number, l: number) => {
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
    const f = (n: number) => {
        const k = (n + h / 30) % 12;
        const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
        return Math.round(c * 255)
            .toString(16)
            .padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
};

/** The institute theme colour when it is a hex value, else the app primary colour. */
export const resolveBrandColor = (themeColor?: string | null): string => {
    if (themeColor && HEX.test(themeColor.trim())) return themeColor.trim();
    if (typeof window === 'undefined') return FALLBACK_BRAND;
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--primary-500');
    const parts = raw.trim().replace(/,/g, ' ').replace(/%/g, '').split(/\s+/).map(Number);
    if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) {
        return hslToHex(parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0);
    }
    return FALLBACK_BRAND;
};

export const useBrandColor = (themeColor?: string | null) =>
    useMemo(() => resolveBrandColor(themeColor), [themeColor]);

/** A light tint of a hex colour (mixed with white), for hero backgrounds and soft fills. */
export const tint = (hex: string, amount: number) => {
    if (!HEX.test(hex)) return '#f5f5ff';
    const n = parseInt(hex.slice(1), 16);
    const mix = (c: number) => Math.round(c + (255 - c) * amount);
    const r = mix((n >> 16) & 255);
    const g = mix((n >> 8) & 255);
    const b = mix(n & 255);
    return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
};

export const pct = (v: number | null | undefined) =>
    v == null ? '—' : `${Math.round(v * 10) / 10}%`;

export const minutesLabel = (v: number | null | undefined) => {
    if (v == null) return '—';
    const m = Math.round(v);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};
