import { describe, expect, it } from 'vitest';
import en from '../../../../public/locales/en/commerce.json';
import hi from '../../../../public/locales/hi/commerce.json';
import {
    PRODUCT_SERVER_ERROR_KEYS,
    firstErrorPath,
    localeOfField,
    mapProductError,
    sectionOfField,
} from './product-errors';

const variants = [
    { sku: 'KURTA-RED-S', barcode: '8901234567890' },
    { sku: 'KURTA-RED-M', barcode: '' },
    { sku: 'KURTA-BLUE-S', barcode: '8901234567891' },
];

const map = (message: string) => mapProductError(message, variants);

/** Sentences exactly as CommerceProductService, CatalogueRules and CommerceTaxClassService write them. */
describe('mapProductError: product fields', () => {
    it('publish without a tax class points at the tax class', () => {
        expect(map('the product needs a tax class before it is published')).toMatchObject({
            field: 'tax_class_id',
            key: 'taxClassMissing',
        });
    });

    it('a tax class with no rate today points at the tax class', () => {
        expect(map('the tax class of the product has no rate in force today')).toMatchObject({
            field: 'tax_class_id',
            key: 'taxClassNoRate',
        });
    });

    it('other tax class refusals stay on the field with the server sentence', () => {
        expect(map('the tax class is archived')).toMatchObject({
            field: 'tax_class_id',
            key: null,
        });
        expect(map('tax_class_id is not a tax class of this institute').field).toBe('tax_class_id');
    });

    it('a taken slug', () => {
        expect(map('Another product already uses the slug lal-kurta')).toMatchObject({
            field: 'slug',
            key: 'slugTaken',
            params: { slug: 'lal-kurta' },
        });
    });

    it('a malformed slug', () => {
        expect(map('slug may hold letters, digits and single hyphens only')).toMatchObject({
            field: 'slug',
            key: 'slugFormat',
        });
    });

    it('how-it-is-sold after publishing', () => {
        expect(
            map('stock_mode, unit and qty_scale cannot change after the product has been published')
        ).toMatchObject({ field: 'sold_as', key: 'measureLocked' });
    });

    it('origin location', () => {
        expect(map('origin_location_id must be a source location')).toMatchObject({
            field: 'origin_location_id',
            key: 'originNotSource',
        });
        expect(map('origin_location_id is not a location of this institute').field).toBe(
            'origin_location_id'
        );
    });

    it('measure numbers', () => {
        expect(map('qty_scale must be 1 or more').field).toBe('qty_scale');
        expect(map('qty_step must be 1 or more').field).toBe('qty_step');
        expect(map('unit is too long').field).toBe('unit');
    });

    it('a missing name', () => {
        expect(map('a new product needs at least one translation with a name')).toMatchObject({
            field: 'translations.hi.name',
            key: 'nameMissing',
        });
        expect(map('a translation needs a name').field).toBe('translations.hi.name');
    });

    it('unknown ids', () => {
        expect(map('unknown collection: c1').field).toBe('collection_ids');
        expect(map('unknown attribute value: v1').field).toBe('attribute_value_ids');
        expect(map('unknown attribute: a1').field).toBe('option_attribute_ids');
    });
});

describe('mapProductError: variant rows', () => {
    it('a SKU used by another product points at that row', () => {
        expect(map('Another variant already uses the sku KURTA-RED-M')).toMatchObject({
            field: 'variants.1.sku',
            key: 'skuTaken',
            params: { sku: 'KURTA-RED-M' },
        });
    });

    it('a SKU twice in the product', () => {
        expect(map('two variants of the product have the sku KURTA-RED-S').field).toBe(
            'variants.0.sku'
        );
    });

    it('a taken barcode points at the barcode cell', () => {
        expect(map('Another variant already uses the barcode 8901234567891')).toMatchObject({
            field: 'variants.2.barcode',
            key: 'barcodeTaken',
        });
    });

    it('a variant without a price at publish', () => {
        expect(
            map('variant KURTA-BLUE-S needs a price before the product is published')
        ).toMatchObject({
            field: 'variants.2.price',
            key: 'priceMissing',
            params: { sku: 'KURTA-BLUE-S' },
        });
    });

    it('piece stock must be tracked', () => {
        expect(
            map('variant KURTA-RED-M must be TRACKED: the product is sold by piece')
        ).toMatchObject({
            field: 'variants.1.stock_policy',
            key: 'pieceTracked',
        });
    });

    it('option value problems point at the row', () => {
        expect(
            map('variant KURTA-RED-S must have exactly one value for each option of the product')
        ).toMatchObject({ field: 'variants.0.sku', key: 'optionValues' });
        expect(
            map('variants KURTA-RED-S and KURTA-RED-M have the same option values')
        ).toMatchObject({
            field: 'variants.1.sku',
            key: 'sameOptionValues',
            params: { first: 'KURTA-RED-S', second: 'KURTA-RED-M' },
        });
    });

    it('a row the form does not hold falls back to the grid', () => {
        expect(map('Another variant already uses the sku GONE').field).toBe('variants');
        expect(map('variant GONE needs a price before the product is published').field).toBe(
            'variants'
        );
    });

    it('grid-wide refusals', () => {
        expect(
            map('a product needs at least one active variant before it is published')
        ).toMatchObject({
            field: 'variants',
            key: 'noActiveVariant',
        });
        expect(map('mrp cannot be below the price')).toMatchObject({
            field: 'variants',
            key: 'mrpBelowPrice',
        });
        expect(map('stock_policy of an existing variant cannot be changed yet').key).toBe(
            'policyLocked'
        );
        expect(map('sku is required for a new variant').key).toBe('skuRequired');
        expect(map('price has more than two decimal places').field).toBe('variants');
    });
});

describe('mapProductError: everything else', () => {
    it('an unknown sentence is kept as written, on the form as a whole', () => {
        expect(map('Something nobody planned for')).toEqual({
            field: null,
            key: null,
            params: {},
            message: 'Something nobody planned for',
        });
    });

    it('a guard refusal is never pinned to a field', () => {
        expect(
            mapProductError('the tax class role is missing', variants, 'ROLE_NOT_ALLOWED')
        ).toMatchObject({ field: null, key: null });
    });

    it('always keeps the server sentence', () => {
        expect(map('  Another product already uses the slug x  ').message).toBe(
            'Another product already uses the slug x'
        );
    });

    it('every key it can answer has a sentence in both languages', () => {
        PRODUCT_SERVER_ERROR_KEYS.forEach((key) => {
            expect(en.products.serverErrors[key], `en ${key}`).toBeTruthy();
            expect(hi.products.serverErrors[key], `hi ${key}`).toBeTruthy();
        });
    });
});

describe('where a field lives', () => {
    it('finds the section card of a field', () => {
        expect(sectionOfField('variants.3.price')).toBe('variants');
        expect(sectionOfField('variants')).toBe('variants');
        expect(sectionOfField('option_attribute_ids')).toBe('variants');
        expect(sectionOfField('tax_class_id')).toBe('tax');
        expect(sectionOfField('qty_step')).toBe('selling');
        expect(sectionOfField('sold_as')).toBe('selling');
        expect(sectionOfField('origin_location_id')).toBe('organise');
        expect(sectionOfField('collection_ids')).toBe('organise');
        expect(sectionOfField('translations.en.name')).toBe('details');
        expect(sectionOfField('slug')).toBe('details');
    });

    it('finds the language tab of a field', () => {
        expect(localeOfField('translations.en.name')).toBe('en');
        expect(localeOfField('translations.hi.content_blocks.0.code')).toBe('hi');
        expect(localeOfField('slug')).toBeNull();
    });

    it('every field mapProductError can answer has a section', () => {
        const sentences = [
            'the product needs a tax class before it is published',
            'Another product already uses the slug x',
            'origin_location_id must be a source location',
            'qty_scale must be 1 or more',
            'a translation needs a name',
            'Another variant already uses the sku KURTA-RED-M',
            'unknown collection: c',
        ];
        expect(sentences.map((s) => sectionOfField(map(s).field ?? ''))).toEqual([
            'tax',
            'details',
            'organise',
            'selling',
            'details',
            'variants',
            'organise',
        ]);
    });
});

describe('firstErrorPath', () => {
    const error = (message: string) => ({ type: 'custom', message });

    it('answers the first field with a message', () => {
        expect(firstErrorPath({ slug: error('bad') })).toBe('slug');
        expect(firstErrorPath({ translations: { en: { name: error('needed') } } })).toBe(
            'translations.en.name'
        );
    });

    it('walks into array rows, skipping the empty ones', () => {
        expect(firstErrorPath({ variants: [undefined, { mrp: error('low') }] })).toBe(
            'variants.1.mrp'
        );
    });

    it('an array-level message answers the array', () => {
        expect(firstErrorPath({ variants: { root: error('none live') } })).toBe('variants');
        expect(firstErrorPath({ variants: error('none live') })).toBe('variants');
    });

    it('nothing wrong, nothing found', () => {
        expect(firstErrorPath({})).toBeNull();
        expect(firstErrorPath(undefined)).toBeNull();
        expect(firstErrorPath({ variants: [] })).toBeNull();
    });

    it('never follows the input element reference', () => {
        expect(firstErrorPath({ slug: { ref: { message: 'x', type: 'y' } } })).toBeNull();
    });
});
