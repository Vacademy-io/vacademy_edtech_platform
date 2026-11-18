/** Contract §7.2: code lookup, bilingual search, the device copy and its 2 MB cap. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    CACHE_MAX_CHARS,
    catalogueCacheKey,
    indexCatalogue,
    lookupCode,
    readCachedCatalogue,
    searchCatalogue,
    writeCachedCatalogue,
} from './pos-catalogue';
import type { PosCatalogue } from './pos-types';
import { hose, item, scarf } from './pos-test-fixtures';

const items = [item(), scarf(), hose()];
const catalogue = (list = items): PosCatalogue => ({
    register_id: 'reg-1',
    location_id: 'loc-1',
    generated_at: null,
    truncated: false,
    items: list,
});

afterEach(() => {
    vi.unstubAllGlobals();
    try {
        localStorage.clear();
    } catch {
        // stubbed storage
    }
});

describe('pos catalogue', () => {
    it('looks a code up by label code, barcode or SKU, ignoring case', () => {
        const index = indexCatalogue(items);
        expect(lookupCode(index, 'v-bottle')?.variant_id).toBe('ps-bottle');
        expect(lookupCode(index, '8900000000017')?.variant_id).toBe('ps-bottle');
        expect(lookupCode(index, 'scf-1')?.variant_id).toBe('ps-scarf');
        expect(lookupCode(index, 'NOPE')).toBeNull();
    });

    it('searches names in Hindi and English and SKU prefixes', () => {
        const index = indexCatalogue(items);
        expect(searchCatalogue(index, 'bottle', 'en').map((i) => i.variant_id)).toEqual(['ps-bottle']);
        expect(searchCatalogue(index, 'बोतल', 'hi').map((i) => i.variant_id)).toEqual(['ps-bottle']);
        // The other language still finds it.
        expect(searchCatalogue(index, 'स्कार्फ़', 'en').map((i) => i.variant_id)).toEqual(['ps-scarf']);
        expect(searchCatalogue(index, 'HSE', 'en').map((i) => i.variant_id)).toEqual(['ps-hose']);
        expect(searchCatalogue(index, '', 'en')).toEqual([]);
    });

    it('returns at most 30 results', () => {
        const many = Array.from({ length: 40 }, (_, n) => item({ variant_id: `v${n}`, sku: `BTL-${n}`, label_code: null, barcode: null }));
        expect(searchCatalogue(indexCatalogue(many), 'bottle', 'en')).toHaveLength(30);
    });

    it('writes and reads the device copy', () => {
        expect(writeCachedCatalogue('inst-1', 'reg-1', catalogue())).toBe(true);
        expect(readCachedCatalogue('inst-1', 'reg-1')?.items).toHaveLength(3);
        expect(readCachedCatalogue('inst-1', 'reg-2')).toBeNull();
    });

    it('skips a copy over 2 MB and removes the old one', () => {
        writeCachedCatalogue('inst-1', 'reg-1', catalogue());
        const big = item({ names: { en: 'x'.repeat(CACHE_MAX_CHARS), hi: null } });
        expect(writeCachedCatalogue('inst-1', 'reg-1', catalogue([big]))).toBe(false);
        expect(localStorage.getItem(catalogueCacheKey('inst-1', 'reg-1'))).toBeNull();
    });

    it('survives a storage that throws', () => {
        const throwing = {
            getItem: () => {
                throw new Error('blocked');
            },
            setItem: () => {
                throw new Error('full');
            },
            removeItem: () => {
                throw new Error('blocked');
            },
        };
        vi.stubGlobal('localStorage', throwing);
        expect(writeCachedCatalogue('inst-1', 'reg-1', catalogue())).toBe(false);
        expect(readCachedCatalogue('inst-1', 'reg-1')).toBeNull();
    });
});
