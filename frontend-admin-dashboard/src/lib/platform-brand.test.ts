import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import aiPlansEn from '../../public/locales/en/aiPlans.json';

/** Real en catalogue, so a missing key shows up as the raw key. */
function translate(key: string, vars?: Record<string, unknown>): string {
    const value = key.split('.').reduce<unknown>((node, part) => {
        if (node && typeof node === 'object') return (node as Record<string, unknown>)[part];
        return undefined;
    }, aiPlansEn as unknown);
    if (typeof value !== 'string') return key;
    return value.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars?.[name] ?? ''));
}

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'inst-a' }));
vi.mock('@/lib/auth/axiosInstance', () => ({
    default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

const host = vi.hoisted(() => ({ vacademy: true }));
vi.mock('@/utils/subdomain', async (importOriginal) => {
    const real = await importOriginal<typeof import('@/utils/subdomain')>();
    return {
        ...real,
        isVacademyOwnedDomain: (h?: string) =>
            h !== undefined && h !== 'localhost' ? real.isVacademyOwnedDomain(h) : host.vacademy,
    };
});

import {
    PLATFORM_TRADE_NAME,
    containsBrandWord,
    resolveBrandMode,
    scrubBrand,
    supplierDisplayName,
    usePlatformBrand,
} from './platform-brand';
import {
    normalizeStorefront,
    primeStorefrontCache,
    resetStorefrontCache,
} from '@/services/ai-plans/storefront';

const SUPPLIER = {
    legal_name: 'Vidyayatan Technologies LLP',
    gstin: '23AAYFV8247N1Z3',
    trade_name: 'Vacademy',
    neutral_display_name: 'Vidyayatan Technologies',
    display_name: null,
    support_email: null,
};

function storefront(mode: 'VACADEMY' | 'NEUTRAL') {
    return normalizeStorefront({ brand_mode: mode, plans: [] });
}

describe('resolveBrandMode', () => {
    it('a white-labelled host is always NEUTRAL; a NEUTRAL answer always wins', () => {
        expect(resolveBrandMode('VACADEMY', 'dash.vacademy.io')).toBe('VACADEMY');
        expect(resolveBrandMode('VACADEMY', 'admin.myschool.com')).toBe('NEUTRAL');
        expect(resolveBrandMode(null, 'admin.myschool.com')).toBe('NEUTRAL');
        expect(resolveBrandMode(undefined, 'admin.myschool.com')).toBe('NEUTRAL');
        expect(resolveBrandMode('NEUTRAL', 'dash.vacademy.io')).toBe('NEUTRAL');
        // look-alike hosts are not Vacademy-owned
        expect(resolveBrandMode('VACADEMY', 'vacademy.io.evil.com')).toBe('NEUTRAL');
        expect(resolveBrandMode('VACADEMY', 'notvacademy.io')).toBe('NEUTRAL');
        expect(resolveBrandMode(null, 'notvacademy.io')).toBe('NEUTRAL');
    });

    it('with no server answer (storefront off: the default) a Vacademy-owned host keeps the Vacademy copy', () => {
        expect(resolveBrandMode(null, 'dash.vacademy.io')).toBe('VACADEMY');
        expect(resolveBrandMode(undefined, 'shiksha.vacademy.io')).toBe('VACADEMY');
        expect(resolveBrandMode('vacademy', 'dash.vacademy.io')).toBe('VACADEMY');
    });
});

describe('scrubBrand / supplierDisplayName', () => {
    it('removes the platform word in NEUTRAL and leaves VACADEMY text alone', () => {
        expect(scrubBrand('Vacademy Assistant', 'NEUTRAL', 'Platform')).toBe('Platform Assistant');
        expect(scrubBrand('Ask VACADEMY.io support', 'NEUTRAL', 'Platform')).toBe(
            'Ask Platform support'
        );
        expect(scrubBrand('Vacademy Assistant', 'VACADEMY', 'Platform')).toBe('Vacademy Assistant');
        expect(scrubBrand(null, 'NEUTRAL', 'Platform')).toBeNull();
        expect(containsBrandWord('hello@vacademy.io')).toBe(true);
        expect(containsBrandWord('billing@vidyayatan.com')).toBe(false);
    });

    it('never names the platform brand as the payee in NEUTRAL', () => {
        expect(supplierDisplayName(SUPPLIER, 'VACADEMY', 'x')).toBe('Vacademy');
        expect(supplierDisplayName(SUPPLIER, 'NEUTRAL', 'x')).toBe('Vidyayatan Technologies');
        expect(
            supplierDisplayName(
                { ...SUPPLIER, neutral_display_name: 'Vacademy Pvt', display_name: 'Vacademy' },
                'NEUTRAL',
                'x'
            )
        ).toBe('Vidyayatan Technologies LLP');
        expect(supplierDisplayName(null, 'NEUTRAL', 'the platform')).toBe('the platform');
        expect(supplierDisplayName(null, 'VACADEMY', 'x')).toBe(PLATFORM_TRADE_NAME);
    });
});

describe('usePlatformBrand', () => {
    beforeEach(() => {
        resetStorefrontCache();
        host.vacademy = true;
    });

    it('before the storefront answers, a Vacademy host keeps the Vacademy copy (unchanged with flags off)', () => {
        const { result } = renderHook(() => usePlatformBrand());
        expect(result.current.mode).toBe('VACADEMY');
        expect(result.current.brand).toBe('Vacademy');
        expect(result.current.scrubText('Vacademy Assistant')).toBe('Vacademy Assistant');
    });

    it('before the storefront answers, a white-labelled host is NEUTRAL', () => {
        host.vacademy = false;
        const { result } = renderHook(() => usePlatformBrand());
        expect(result.current.mode).toBe('NEUTRAL');
        expect(result.current.brand).toBe('your platform team');
        expect(result.current.brandTitle).toBe('Your platform team');
        expect(result.current.scrubText('Vacademy Assistant')).toBe('Platform Assistant');
    });

    it('follows the API on a Vacademy host, live', () => {
        const { result } = renderHook(() => usePlatformBrand());
        act(() => primeStorefrontCache('inst-a', storefront('VACADEMY')));
        expect(result.current.mode).toBe('VACADEMY');
        expect(result.current.isVacademy).toBe(true);
        expect(result.current.vars).toEqual({ brand: 'Vacademy', brandTitle: 'Vacademy' });
        expect(result.current.scrubText('Vacademy Assistant')).toBe('Vacademy Assistant');
        act(() => primeStorefrontCache('inst-a', storefront('NEUTRAL')));
        expect(result.current.mode).toBe('NEUTRAL');
    });

    it('never says Vacademy on a white-labelled host, whatever the API says', () => {
        host.vacademy = false;
        primeStorefrontCache('inst-a', storefront('VACADEMY'));
        const { result } = renderHook(() => usePlatformBrand());
        expect(result.current.mode).toBe('NEUTRAL');
        expect(result.current.brand).not.toMatch(/vacademy/i);
        expect(result.current.brandTitle).not.toMatch(/vacademy/i);
    });

    it('a storefront that is off (null) falls back to the host', () => {
        primeStorefrontCache('inst-a', null);
        const { result } = renderHook(() => usePlatformBrand());
        expect(result.current.mode).toBe('VACADEMY');
        host.vacademy = false;
        const { result: wl } = renderHook(() => usePlatformBrand());
        expect(wl.current.mode).toBe('NEUTRAL');
    });
});

describe('locale copy', () => {
    it('the aiPlans namespace never names the platform brand', () => {
        expect(JSON.stringify(aiPlansEn)).not.toMatch(/vacademy/i);
    });
});
