/**
 * Platform brand for tenant billing copy (AI plans, limits, invoices).
 *
 * Two inputs:
 *   1. the host the app is served from right now (isVacademyOwnedDomain): a
 *      white-labelled host is ALWAYS NEUTRAL, whatever the server says;
 *   2. the server's brand_mode for the institute (from the storefront GET;
 *      VACADEMY only for institutes without a custom admin domain): a NEUTRAL
 *      answer always wins.
 * With no server answer (the storefront is off — the default — not loaded yet,
 * or failed) the host decides, so Vacademy-owned hosts keep the copy they had
 * before plans existed ("Set by Vacademy") while the storefront is dark. In
 * NEUTRAL the UI says "your platform team", and any server string that still
 * carries the platform name is scrubbed before it renders.
 */
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { isVacademyOwnedDomain } from '@/utils/subdomain';
import {
    getStorefrontSnapshot,
    subscribeStorefront,
    type BrandMode,
    type PlanSupplier,
} from '@/services/ai-plans/storefront';

/** The platform's trade name. Used only in VACADEMY mode; never in a locale file. */
export const PLATFORM_TRADE_NAME = 'Vacademy';

/** Words that must never reach a NEUTRAL screen (case-insensitive, whole word). */
const BRAND_WORD = /\bvacademy(?:\.io)?\b/gi;

export function resolveBrandMode(apiMode: unknown, hostname?: string): BrandMode {
    const host = hostname ?? (typeof window !== 'undefined' ? window.location.hostname : '');
    if (!isVacademyOwnedDomain(host)) return 'NEUTRAL';
    if (apiMode === 'NEUTRAL') return 'NEUTRAL';
    // VACADEMY, or no answer from the server: the Vacademy-owned host decides.
    return 'VACADEMY';
}

/** Server text in NEUTRAL mode: the platform word is replaced, never shown. */
export function scrubBrand(text: string, mode: BrandMode, replacement: string): string;
export function scrubBrand(
    text: string | null,
    mode: BrandMode,
    replacement: string
): string | null;
export function scrubBrand(
    text: string | null,
    mode: BrandMode,
    replacement: string
): string | null {
    if (text === null || mode === 'VACADEMY') return text;
    return text
        .replace(BRAND_WORD, replacement)
        .replace(/\s{2,}/g, ' ')
        .trim();
}

export function containsBrandWord(text: string | null | undefined): boolean {
    if (!text) return false;
    BRAND_WORD.lastIndex = 0;
    const hit = BRAND_WORD.test(text);
    BRAND_WORD.lastIndex = 0;
    return hit;
}

/**
 * Who the admin pays, as shown before the redirect. VACADEMY: the trade name.
 * NEUTRAL: the neutral display name, else the legal supplier — and never a
 * name carrying the platform word, whatever the server sent.
 */
export function supplierDisplayName(
    supplier: PlanSupplier | null | undefined,
    mode: BrandMode,
    fallback: string
): string {
    const s = supplier ?? null;
    const candidates =
        mode === 'VACADEMY'
            ? [s?.trade_name, s?.display_name, PLATFORM_TRADE_NAME]
            : [s?.neutral_display_name, s?.legal_name, s?.display_name];
    for (const c of candidates) {
        if (!c || c.trim() === '') continue;
        if (mode === 'NEUTRAL' && containsBrandWord(c)) continue;
        return c.trim();
    }
    return fallback;
}

export interface PlatformBrand {
    mode: BrandMode;
    isVacademy: boolean;
    /** In-sentence brand token: "Vacademy" or "your platform team". */
    brand: string;
    /** Sentence-start / label form: "Vacademy" or "Your platform team". */
    brandTitle: string;
    /** Interpolation bag for strings carrying {{brand}} / {{brandTitle}}. */
    vars: { brand: string; brandTitle: string };
    scrub: (text: string | null) => string | null;
    scrubText: (text: string) => string;
}

/**
 * Brand for the current institute. Reads the storefront cache only (no
 * request of its own), so it is safe anywhere — including the dialogs that
 * mount outside the app's QueryClient. Until the storefront has loaded, or when
 * it is off, the host decides (see resolveBrandMode).
 */
export function usePlatformBrand(instituteId?: string | null): PlatformBrand {
    const { t } = useTranslation('aiPlans');
    const id = instituteId ?? safeInstituteId();
    const apiMode = useSyncExternalStore(
        subscribeStorefront,
        () => getStorefrontSnapshot(id)?.brand_mode ?? null,
        () => null
    );
    const mode = resolveBrandMode(apiMode);
    const neutral = t('brand.neutral', { defaultValue: 'your platform team' });
    const neutralTitle = t('brand.neutralTitle', { defaultValue: 'Your platform team' });
    const neutralWord = t('brand.neutralWord', { defaultValue: 'Platform' });
    const brand = mode === 'VACADEMY' ? PLATFORM_TRADE_NAME : neutral;
    const brandTitle = mode === 'VACADEMY' ? PLATFORM_TRADE_NAME : neutralTitle;
    const scrub = useCallback(
        (text: string | null) => scrubBrand(text, mode, neutralWord),
        [mode, neutralWord]
    );
    return useMemo(
        () => ({
            mode,
            isVacademy: mode === 'VACADEMY',
            brand,
            brandTitle,
            vars: { brand, brandTitle },
            scrub,
            scrubText: (text: string) => scrubBrand(text, mode, neutralWord),
        }),
        [mode, brand, brandTitle, scrub, neutralWord]
    );
}

function safeInstituteId(): string | null {
    try {
        return getCurrentInstituteId() ?? null;
    } catch {
        return null;
    }
}
