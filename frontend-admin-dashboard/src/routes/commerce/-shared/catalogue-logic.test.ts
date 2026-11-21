import { describe, expect, it } from 'vitest';
import {
    EMPTY_COLLECTION,
    collectionToValues,
    valuesToCollectionRequest,
} from '../collections/-components/collection-form';
import { mediaTagLabel, offeredMediaTags } from '../products/-components/media-tags';
import {
    blobErrorMessage,
    filenameOf,
    normalizeMediaTags,
    importJobIsRunning,
    importJobPercent,
    normalizeImportJob,
    normalizeImportValidation,
    normalizeProduct,
} from './catalogue-api';
import {
    flattenTree,
    i18nName,
    moveAmongSiblings,
    parentChoices,
    siblingsOf,
    subtreeIds,
} from './collection-tree';
import type { CommerceCollection } from './commerce-types';
import {
    renditionError,
    renditionFor,
    renditionInProgress,
    renditionStatus,
    renditionUrls,
} from './media-renditions';
import { productWarnings, selectionAfterBulk, serverFilterSupport } from './product-list';

const node = (
    id: string,
    position: number | null,
    children: CommerceCollection[] = []
): CommerceCollection => ({
    id,
    parent_id: null,
    kind: 'CATEGORY',
    slug: id,
    name_i18n: { en: id.toUpperCase() },
    description_i18n: null,
    media_id: null,
    return_window_days: null,
    position,
    status: 'ACTIVE',
    external_ref: null,
    children,
});

const tree = [
    node('women', 1, [node('sarees', 0, [node('silk', 0)]), node('kurtas', 1)]),
    node('men', 0),
];

describe('collection tree', () => {
    it('flattens depth-first with siblings by position', () => {
        expect(flattenTree(tree).map((entry) => [entry.collection.id, entry.depth])).toEqual([
            ['men', 0],
            ['women', 0],
            ['sarees', 1],
            ['silk', 2],
            ['kurtas', 1],
        ]);
    });

    it('knows each row index among its siblings', () => {
        const kurtas = flattenTree(tree).find((entry) => entry.collection.id === 'kurtas');
        expect(kurtas).toMatchObject({ index: 1, siblings: 2 });
    });

    it('lists a collection with everything under it', () => {
        const women = tree[0];
        if (!women) throw new Error('fixture');
        expect(subtreeIds(women)).toEqual(['women', 'sarees', 'silk', 'kurtas']);
    });

    it('a collection cannot be moved under itself or its descendants', () => {
        const women = tree[0];
        if (!women) throw new Error('fixture');
        expect(parentChoices(tree, women).map((entry) => entry.collection.id)).toEqual(['men']);
        expect(parentChoices(tree, null)).toHaveLength(5);
    });

    it('finds the siblings of a nested collection', () => {
        expect(siblingsOf(tree, 'kurtas').map((n) => n.id)).toEqual(['sarees', 'kurtas']);
        expect(siblingsOf(tree, 'men').map((n) => n.id)).toEqual(['women', 'men']);
        expect(siblingsOf(tree, 'nope')).toEqual([]);
    });

    it('moving down swaps two positions', () => {
        expect(moveAmongSiblings(tree, 'men', 'down')).toEqual([
            { id: 'women', position: 0 },
            { id: 'men', position: 1 },
        ]);
    });

    it('moving past either end writes nothing', () => {
        expect(moveAmongSiblings(tree, 'men', 'up')).toEqual([]);
        expect(moveAmongSiblings(tree, 'women', 'down')).toEqual([]);
        expect(moveAmongSiblings(tree, 'nope', 'up')).toEqual([]);
    });

    it('repairs repeated stored positions while it moves', () => {
        const same = [node('a', 0), node('b', 0), node('c', 0)];
        expect(moveAmongSiblings(same, 'c', 'up')).toEqual([
            { id: 'c', position: 1 },
            { id: 'b', position: 2 },
        ]);
    });

    it('picks the name in the admin language, then the other one', () => {
        expect(i18nName({ hi: 'साड़ी', en: 'Sarees' }, 'hi')).toBe('साड़ी');
        expect(i18nName({ hi: 'साड़ी', en: 'Sarees' }, 'en-IN')).toBe('Sarees');
        expect(i18nName({ en: 'Sarees' }, 'hi')).toBe('Sarees');
        expect(i18nName({ hi: 'साड़ी' }, 'fr')).toBe('साड़ी');
        expect(i18nName(null, 'hi', 'sarees')).toBe('sarees');
    });
});

describe('import: validation result', () => {
    const body = {
        file_name: 'kurtas.xlsx',
        rows_total: 500,
        rows_skipped: 2,
        products_total: 120,
        products_to_create: 100,
        products_to_update: 15,
        variants_to_create: 430,
        variants_to_update: 50,
        products_with_errors: 5,
        rows_with_errors: 20,
        error_count: 7,
        warning_count: 3,
        issues: [
            {
                row: 12,
                column: 'tax_class',
                severity: 'ERROR',
                code: 'UNKNOWN_TAX_CLASS',
                message: 'unknown tax class',
                handle: 'khadi-kurta',
            },
            {
                row: 13,
                column: null,
                severity: 'WARNING',
                code: 'MISSING_HINDI_NAME',
                message: 'no Hindi name',
                handle: 'silk-saree',
            },
        ],
        issues_truncated: false,
    };

    it('reads the counts and the findings as the server sends them', () => {
        const result = normalizeImportValidation(body);
        expect(result).toMatchObject({
            file_name: 'kurtas.xlsx',
            rows_total: 500,
            rows_skipped: 2,
            products_to_create: 100,
            products_to_update: 15,
            variants_to_create: 430,
            variants_to_update: 50,
            products_with_errors: 5,
            rows_with_errors: 20,
            error_count: 7,
            warning_count: 3,
            issues_truncated: false,
        });
        expect(result.issues[0]).toEqual({
            row: 12,
            column: 'tax_class',
            severity: 'ERROR',
            code: 'UNKNOWN_TAX_CLASS',
            message: 'unknown tax class',
            handle: 'khadi-kurta',
        });
        expect(result.issues[1]).toMatchObject({ column: null, severity: 'WARNING' });
    });

    it('the exact counts win over the capped list', () => {
        const result = normalizeImportValidation({
            ...body,
            error_count: 4000,
            issues_truncated: true,
        });
        expect(result.error_count).toBe(4000);
        expect(result.issues).toHaveLength(2);
        expect(result.issues_truncated).toBe(true);
    });

    it('counts the findings itself when the server sends no counts', () => {
        const rest = { ...body, error_count: undefined, warning_count: undefined };
        expect(normalizeImportValidation(rest)).toMatchObject({
            error_count: 1,
            warning_count: 1,
        });
    });

    it('an unknown severity is treated as an error, never hidden', () => {
        const result = normalizeImportValidation({
            issues: [{ row: 1, severity: 'FATAL', message: 'x' }],
        });
        expect(result.issues[0]?.severity).toBe('ERROR');
    });

    it('rubbish in, an empty result out', () => {
        expect(normalizeImportValidation(null)).toMatchObject({
            rows_total: 0,
            issues: [],
            error_count: 0,
        });
        expect(normalizeImportValidation({ issues: [null, 'x', { row: 1 }] }).issues).toEqual([]);
    });
});

describe('import: job', () => {
    const body = {
        job_id: 'job-1',
        status: 'RUNNING',
        file_name: 'kurtas.xlsx',
        rows_total: 500,
        rows_done: 120,
        rows_failed: 5,
        products_total: 120,
        products_created: 30,
        products_updated: 4,
        products_failed: 1,
        variants_created: 110,
        variants_updated: 10,
        image_urls_queued: 64,
        error_count: 1,
        issues: [
            {
                row: 9,
                column: 'sku',
                severity: 'ERROR',
                code: 'DUPLICATE_SKU',
                message: 'duplicate sku',
                handle: 'a',
            },
        ],
        issues_truncated: false,
        created_package_ids: ['p1', 'p2'],
        error_rows_available: true,
        failure_message: null,
    };

    it('reads the job as the server sends it', () => {
        expect(normalizeImportJob(body)).toMatchObject({
            job_id: 'job-1',
            status: 'RUNNING',
            rows_total: 500,
            rows_done: 120,
            rows_failed: 5,
            products_created: 30,
            products_updated: 4,
            products_failed: 1,
            variants_created: 110,
            variants_updated: 10,
            image_urls_queued: 64,
            created_package_ids: ['p1', 'p2'],
            error_rows_available: true,
            failure_message: null,
        });
    });

    it('a body without a job id is not a job', () => {
        expect(normalizeImportJob({ status: 'RUNNING' })).toBeNull();
        expect(normalizeImportJob(null)).toBeNull();
    });

    it('a job with no status yet is waiting', () => {
        expect(normalizeImportJob({ job_id: 'j' })?.status).toBe('QUEUED');
    });

    it('progress counts failed rows as dealt with', () => {
        expect(importJobPercent({ rows_total: 500, rows_done: 120, rows_failed: 5 })).toBe(25);
        expect(importJobPercent({ rows_total: 3, rows_done: 3, rows_failed: 0 })).toBe(100);
        expect(importJobPercent({ rows_total: 0, rows_done: 0, rows_failed: 0 })).toBe(0);
        expect(importJobPercent({ rows_total: 10, rows_done: 9, rows_failed: 4 })).toBe(100);
    });

    it('only QUEUED and RUNNING are still polled', () => {
        expect(importJobIsRunning({ status: 'QUEUED' })).toBe(true);
        expect(importJobIsRunning({ status: 'RUNNING' })).toBe(true);
        expect(importJobIsRunning({ status: 'COMPLETED' })).toBe(false);
        expect(importJobIsRunning({ status: 'COMPLETED_WITH_ERRORS' })).toBe(false);
        expect(importJobIsRunning({ status: 'FAILED' })).toBe(false);
        expect(importJobIsRunning(null)).toBe(false);
    });
});

describe('downloads', () => {
    it('reads the file name the server gives', () => {
        expect(filenameOf('attachment; filename="products-2026-11-14.csv"')).toBe(
            'products-2026-11-14.csv'
        );
        expect(filenameOf('attachment; filename=template.xlsx')).toBe('template.xlsx');
    });

    it('prefers the encoded name, so a Hindi file name survives', () => {
        const name = 'उत्पाद.csv';
        expect(
            filenameOf(`attachment; filename="x.csv"; filename*=UTF-8''${encodeURIComponent(name)}`)
        ).toBe(name);
    });

    it('no header, no name', () => {
        expect(filenameOf(undefined)).toBeNull();
        expect(filenameOf('inline')).toBeNull();
    });

    it('reads the server sentence out of a failed download', async () => {
        const blob = new Blob([JSON.stringify({ message: 'the export would pass 20000 rows' })]);
        expect(await blobErrorMessage({ response: { data: blob } })).toBe(
            'the export would pass 20000 rows'
        );
        expect(await blobErrorMessage({ response: { data: new Blob(['<html>']) } })).toBeNull();
        expect(await blobErrorMessage({ response: { data: { message: 'x' } } })).toBeNull();
        expect(await blobErrorMessage(new Error('network'))).toBeNull();
    });
});

describe('image renditions', () => {
    const ready = {
        '640': 'https://cdn/640.webp',
        '320': 'https://cdn/320.webp',
        _status: 'READY',
        _attempts: 1,
    };

    it('an image nobody has looked at yet is pending', () => {
        expect(renditionStatus(null)).toBe('PENDING');
        expect(renditionStatus({})).toBe('PENDING');
        expect(renditionInProgress(null)).toBe(true);
    });

    it('reads the status the job wrote', () => {
        expect(renditionStatus({ _status: 'PROCESSING' })).toBe('PROCESSING');
        expect(renditionStatus({ _status: 'FAILED', _error: 'not an image' })).toBe('FAILED');
        expect(renditionStatus(ready)).toBe('READY');
        expect(renditionInProgress({ _status: 'PROCESSING' })).toBe(true);
        expect(renditionInProgress(ready)).toBe(false);
        expect(renditionInProgress({ _status: 'FAILED' })).toBe(false);
    });

    it('a state without a status is ready when it has URLs', () => {
        expect(renditionStatus({ '320': 'https://cdn/320.webp' })).toBe('READY');
        expect(renditionStatus({ _status: 'SOMETHING_NEW' })).toBe('PENDING');
    });

    it('lists widths narrowest first, without the job keys', () => {
        expect(renditionUrls(ready)).toEqual([
            { width: 320, url: 'https://cdn/320.webp' },
            { width: 640, url: 'https://cdn/640.webp' },
        ]);
        expect(renditionUrls({ '320': '', '640': 7, _status: 'READY' })).toEqual([]);
    });

    it('picks the narrowest rendition that is wide enough', () => {
        expect(renditionFor(ready, 320)).toBe('https://cdn/320.webp');
        expect(renditionFor(ready, 400)).toBe('https://cdn/640.webp');
        expect(renditionFor(ready, 2000)).toBe('https://cdn/640.webp');
        expect(renditionFor(null, 320)).toBeNull();
    });

    it('says why the job gave up', () => {
        expect(renditionError({ _status: 'FAILED', _error: 'not an image' })).toBe('not an image');
        expect(renditionError(ready)).toBeNull();
    });
});

describe('normalizeProduct', () => {
    it('refuses a body without a product id', () => {
        expect(normalizeProduct({})).toBeNull();
        expect(normalizeProduct(null)).toBeNull();
    });

    it('fills what the server left out and orders variants by position', () => {
        const product = normalizeProduct({
            package_id: 'p1',
            variants: [
                {
                    package_session_id: 'b',
                    position: 2,
                    price: '10.50',
                    option_values: { size: 's', bad: 3 },
                },
                { package_session_id: 'a', position: 1 },
                { sku: 'no id' },
            ],
            translations: [
                {
                    locale: 'hi',
                    name: 'कुर्ता',
                    content_blocks: [{ code: 'care', html: 'x' }, { html: 'y' }],
                },
            ],
        });
        expect(product?.status).toBe('DRAFT');
        expect(product?.variants.map((v) => v.package_session_id)).toEqual(['a', 'b']);
        expect(product?.variants[1]).toMatchObject({ price: 10.5, option_values: { size: 's' } });
        expect(product?.translations[0]?.content_blocks).toEqual([{ code: 'care', html: 'x' }]);
        expect(product?.collection_ids).toEqual([]);
    });
});

describe('product list helpers', () => {
    it('warns about a missing language', () => {
        expect(productWarnings({ names: { en: 'Red kurta' } })).toEqual(['missingHindi']);
        expect(productWarnings({ names: { hi: 'लाल कुर्ता' } })).toEqual(['missingEnglish']);
        expect(productWarnings({ names: { hi: 'लाल कुर्ता', en: 'Red kurta' } })).toEqual([]);
    });

    it('warns about a missing tax class only when the server sends the field', () => {
        expect(productWarnings({ names: { hi: 'a', en: 'b' }, tax_class_id: null })).toEqual([
            'missingTaxClass',
        ]);
        expect(productWarnings({ names: { hi: 'a', en: 'b' }, tax_class_id: 't' })).toEqual([]);
    });

    it('knows the tax class filter is read by the server and the stock filter is not yet', () => {
        // An empty page of the tax class filter is a real answer, not a missing filter.
        expect(serverFilterSupport([])).toEqual({ stockState: false, taxClass: true });
        const row = {
            package_id: 'p',
            external_ref: null,
            slug: 'p',
            status: 'ACTIVE',
            brand: null,
            names: null,
            variant_count: 1,
            min_price: null,
            max_price: null,
            currency: null,
            updated_at: null,
        };
        expect(serverFilterSupport([{ ...row, tax_class_id: null }]).stockState).toBe(false);
        expect(serverFilterSupport([{ ...row, stock_state: 'LOW_STOCK' }]).stockState).toBe(true);
    });

    it('keeps only the failed rows selected after a bulk action', () => {
        expect(selectionAfterBulk(['a', 'b', 'c'], [{ id: 'b', message: 'no price' }])).toEqual({
            b: true,
        });
        expect(selectionAfterBulk(['a'], [])).toEqual({});
    });
});

describe('photo tags come from the institute', () => {
    it('reads the list and the lead tag, dropping what is not a short text', () => {
        expect(
            normalizeMediaTags({
                tags: ['REAL', 'RENDER', 7, '', 'REAL', 'x'.repeat(40)],
                lead_tag: 'REAL',
            })
        ).toEqual({ tags: ['REAL', 'RENDER'], lead_tag: 'REAL' });
        expect(normalizeMediaTags(null)).toEqual({ tags: [], lead_tag: null });
    });

    it('offers the institute list, so a shop that leads with REAL can tag a photo REAL', () => {
        expect(offeredMediaTags({ tags: ['REAL', 'RENDER'], lead_tag: 'REAL' }, null)).toEqual([
            'REAL',
            'RENDER',
        ]);
    });

    it('keeps a tag the photo already carries, and falls back while the list is not loaded', () => {
        expect(offeredMediaTags({ tags: ['REAL'], lead_tag: 'REAL' }, 'LOOM')).toEqual([
            'REAL',
            'LOOM',
        ]);
        expect(offeredMediaTags(undefined, null)).toEqual(['HERO', 'SWATCH', 'SIZE_CHART']);
    });

    it('names a known tag and shows any other as stored', () => {
        const t = (key: string) => `t:${key}`;
        expect(mediaTagLabel(t, 'REAL')).toBe('t:products.media.tags.REAL');
        expect(mediaTagLabel(t, 'LOOM')).toBe('LOOM');
    });
});

describe('collection form', () => {
    const stored: CommerceCollection = {
        id: 'c1',
        parent_id: null,
        kind: 'CATEGORY',
        slug: 'sarees',
        name_i18n: { hi: 'साड़ियाँ', en: 'Sarees' },
        description_i18n: { en: 'Handwoven sarees' },
        media_id: 'file-1',
        return_window_days: 7,
        position: 0,
        status: 'ACTIVE',
        external_ref: null,
    };

    it('loads the description and the picture', () => {
        expect(collectionToValues(stored)).toMatchObject({
            description_hi: '',
            description_en: 'Handwoven sarees',
            media_id: 'file-1',
        });
    });

    it('sends the description per language and the picture', () => {
        const request = valuesToCollectionRequest({
            ...collectionToValues(stored),
            description_hi: ' हाथ से बुनी साड़ियाँ ',
        });
        expect(request.description_i18n).toEqual({
            hi: 'हाथ से बुनी साड़ियाँ',
            en: 'Handwoven sarees',
        });
        expect(request.media_id).toBe('file-1');
    });

    it('an emptied description and a removed picture are sent as empty, which clears them', () => {
        const request = valuesToCollectionRequest({ ...EMPTY_COLLECTION, name_hi: 'साड़ियाँ' });
        expect(request.description_i18n).toEqual({});
        expect(request.media_id).toBe('');
    });
});
