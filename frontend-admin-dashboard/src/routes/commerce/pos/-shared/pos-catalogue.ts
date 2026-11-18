import type { CatalogueItem, PosCatalogue } from './pos-types';

/**
 * The till's own copy of the catalogue (contract §7.2): codes looked up
 * without a round trip, typed search in Hindi and English, and a copy in
 * `localStorage` so scanning and search keep working when the internet drops.
 * Every storage access is in try/catch: a private window, a full disk or a
 * blocked site just means "no copy".
 */

export const SEARCH_LIMIT = 30;
/** A copy bigger than this is not written (localStorage is ~5 MB per site). */
export const CACHE_MAX_CHARS = 2 * 1024 * 1024;

export interface CatalogueIndex {
    items: CatalogueItem[];
    byCode: Map<string, CatalogueItem>;
}

const norm = (value: string | null | undefined): string =>
    (value ?? '').normalize('NFC').trim().toLowerCase();

export function indexCatalogue(items: CatalogueItem[]): CatalogueIndex {
    const byCode = new Map<string, CatalogueItem>();
    // Label code first, then barcode, then SKU: an earlier kind is never overwritten.
    (['label_code', 'barcode', 'sku'] as const).forEach((field) => {
        items.forEach((item) => {
            const code = norm(item[field]);
            if (code && !byCode.has(code)) byCode.set(code, item);
        });
    });
    return { items, byCode };
}

/** The item a scanned or typed code names (label code, barcode or SKU), else null. */
export const lookupCode = (index: CatalogueIndex, code: string): CatalogueItem | null =>
    index.byCode.get(norm(code)) ?? null;

/**
 * Items whose name (either language) contains the text, or whose SKU starts
 * with it. SKU matches and names that start with the text come first; at most
 * {@link SEARCH_LIMIT}.
 */
export function searchCatalogue(index: CatalogueIndex, text: string, locale: 'hi' | 'en'): CatalogueItem[] {
    const q = norm(text);
    if (!q) return [];
    const scored: { item: CatalogueItem; score: number }[] = [];
    index.items.forEach((item) => {
        const own = norm(locale === 'hi' ? item.names.hi : item.names.en);
        const other = norm(locale === 'hi' ? item.names.en : item.names.hi);
        const variant = `${norm(item.variant_label.hi)} ${norm(item.variant_label.en)}`;
        const sku = norm(item.sku);
        let score = 0;
        if (sku && sku.startsWith(q)) score = 4;
        else if (own.startsWith(q)) score = 3;
        else if (own.includes(q) || other.startsWith(q)) score = 2;
        else if (other.includes(q) || variant.includes(q)) score = 1;
        if (score > 0) scored.push({ item, score });
    });
    return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, SEARCH_LIMIT)
        .map((entry) => entry.item);
}

export const catalogueCacheKey = (instituteId: string, registerId: string) =>
    `commerce.pos.catalogue.${instituteId}.${registerId}`;

function storage(): Storage | null {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

export function readCachedCatalogue(instituteId: string, registerId: string): PosCatalogue | null {
    try {
        const raw = storage()?.getItem(catalogueCacheKey(instituteId, registerId));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as PosCatalogue;
        if (!parsed || !Array.isArray(parsed.items)) return null;
        return parsed;
    } catch {
        return null;
    }
}

/** Writes the copy; false when it was too big or storage refused. */
export function writeCachedCatalogue(instituteId: string, registerId: string, catalogue: PosCatalogue): boolean {
    try {
        const raw = JSON.stringify(catalogue);
        const store = storage();
        if (!store) return false;
        if (raw.length > CACHE_MAX_CHARS) {
            store.removeItem(catalogueCacheKey(instituteId, registerId));
            return false;
        }
        store.setItem(catalogueCacheKey(instituteId, registerId), raw);
        return true;
    } catch {
        return false;
    }
}

/** The register picked last on this device (P1). */
export const lastRegisterKey = (instituteId: string) => `commerce.pos.register.${instituteId}`;

export function readLastRegister(instituteId: string): string | null {
    try {
        return storage()?.getItem(lastRegisterKey(instituteId)) ?? null;
    } catch {
        return null;
    }
}

export function writeLastRegister(instituteId: string, registerId: string): void {
    try {
        storage()?.setItem(lastRegisterKey(instituteId), registerId);
    } catch {
        // No storage: the screen simply does not remember.
    }
}

/** Device setting: print the bill as soon as it is made (default on). */
export const autoPrintKey = (instituteId: string, registerId: string) =>
    `commerce.pos.autoprint.${instituteId}.${registerId}`;

export function readAutoPrint(instituteId: string, registerId: string): boolean {
    try {
        return storage()?.getItem(autoPrintKey(instituteId, registerId)) !== 'off';
    } catch {
        return true;
    }
}

export function writeAutoPrint(instituteId: string, registerId: string, on: boolean): void {
    try {
        storage()?.setItem(autoPrintKey(instituteId, registerId), on ? 'on' : 'off');
    } catch {
        // Not remembered; the default (on) applies next time.
    }
}
