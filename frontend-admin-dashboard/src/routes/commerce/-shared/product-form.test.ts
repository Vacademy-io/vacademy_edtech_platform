import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import type { ProductDetail } from './catalogue-types';
import {
    type ProductFormValues,
    buildProductSchema,
    emptyProductValues,
    emptyVariant,
    measureFields,
    baseToPerUnit,
    dividesToPaise,
    perUnitToBase,
    priceScaleOf,
    productToValues,
    publishBlockers,
    soldAsOf,
    stepToBase,
    translationHasText,
    translationIsComplete,
    valuesToProductRequest,
} from './product-form';

const t = ((key: string) => key) as unknown as TFunction;
const schema = buildProductSchema(t);

const product = (over: Partial<ProductDetail> = {}): ProductDetail => ({
    package_id: 'pkg-1',
    external_ref: null,
    slug: 'lal-kurta',
    stock_mode: 'QUANTITY',
    tax_class_id: 'tax-1',
    brand: 'Example Brand',
    unit: 'PCS',
    qty_scale: 1,
    qty_step: 1,
    origin_location_id: 'loc-1',
    status: 'DRAFT',
    published_at: null,
    seo_i18n: { hi: { title: 'लाल कुर्ता', description: 'हाथ से बुना' } },
    translations: [
        {
            locale: 'en',
            name: 'Red kurta',
            short_description: 'Handwoven',
            description_html: '<p>Soft cotton</p>',
            content_blocks: [{ code: 'care', html: '<p>Hand wash</p>' }],
        },
        {
            locale: 'hi',
            name: 'लाल कुर्ता',
            short_description: null,
            description_html: '<p>मुलायम सूती</p>',
            content_blocks: [],
        },
    ],
    option_attribute_ids: ['size'],
    attribute_value_ids: ['fabric-cotton'],
    collection_ids: ['col-1'],
    variants: [
        {
            package_session_id: 'ps-s',
            name: 'S',
            sku: 'KURTA-S',
            barcode: '890',
            label_code: 'V000001',
            stock_policy: 'TRACKED',
            lead_time_days: null,
            weight_grams: 250,
            position: 0,
            status: 'ACTIVE',
            external_ref: null,
            price: 1299.5,
            mrp: 1499,
            currency: 'INR',
            option_values: { size: 's' },
        },
        {
            package_session_id: 'ps-m',
            name: 'M',
            sku: 'KURTA-M',
            barcode: null,
            label_code: 'V000002',
            stock_policy: 'UNTRACKED',
            lead_time_days: 7,
            weight_grams: null,
            position: 1,
            status: 'ARCHIVED',
            external_ref: null,
            price: 1299.5,
            mrp: null,
            currency: 'INR',
            option_values: { size: 'm' },
        },
    ],
    updated_at: null,
    ...over,
});

const valid = (over: Partial<ProductFormValues> = {}): ProductFormValues => {
    const values = emptyProductValues();
    values.translations.hi.name = 'लाल कुर्ता';
    values.variants = [{ ...emptyVariant(), sku: 'KURTA', price: '999', mrp: '1299' }];
    return { ...values, ...over };
};

const paths = (values: ProductFormValues): string[] => {
    const result = schema.safeParse(values);
    return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
};

describe('productToValues', () => {
    const values = productToValues(product());

    it('puts each language in its own tab, Hindi and English', () => {
        expect(values.translations.hi.name).toBe('लाल कुर्ता');
        expect(values.translations.en.name).toBe('Red kurta');
        expect(values.translations.en.content_blocks).toEqual([
            { code: 'care', html: '<p>Hand wash</p>' },
        ]);
        expect(values.translations.hi.short_description).toBe('');
    });

    it('reads SEO text per language', () => {
        expect(values.translations.hi.seo_title).toBe('लाल कुर्ता');
        expect(values.translations.en.seo_title).toBe('');
    });

    it('keeps numbers as the text to edit', () => {
        expect(values.variants[0]).toMatchObject({
            price: '1299.5',
            mrp: '1499',
            weight_grams: '250',
            barcode: '890',
            label_code: 'V000001',
        });
        expect(values.variants[1]).toMatchObject({ mrp: '', barcode: '', lead_time_days: '7' });
    });

    it('ticks the option values that live variants use', () => {
        expect(values.option_value_ids).toEqual({ size: ['s'] });
    });

    it('a missing language is an empty tab, not a crash', () => {
        const only = productToValues(product({ translations: [], seo_i18n: null }));
        expect(only.translations.hi.name).toBe('');
        expect(only.translations.en.content_blocks).toEqual([]);
    });
});

describe('soldAsOf and measureFields', () => {
    it('reads the three ways of selling', () => {
        expect(soldAsOf({ stock_mode: 'PIECE', qty_scale: 1 })).toBe('PIECE');
        expect(soldAsOf({ stock_mode: 'QUANTITY', qty_scale: null })).toBe('QUANTITY');
        expect(soldAsOf({ stock_mode: 'QUANTITY', qty_scale: 10 })).toBe('MEASURED');
    });

    it('goods sold by length default to metres in tenths', () => {
        expect(
            // The smallest cut is typed in metres (WP-44 FA2): 0.5 m is 5 tenths.
            measureFields({ sold_as: 'MEASURED', unit: '', qty_scale: '', qty_step: '0.5' })
        ).toEqual({
            stock_mode: 'QUANTITY',
            unit: 'MTR',
            qty_scale: 10,
            qty_step: 5,
        });
    });

    it('pieces and counted goods are whole units', () => {
        expect(
            measureFields({ sold_as: 'PIECE', unit: '', qty_scale: '10', qty_step: '5' })
        ).toEqual({
            stock_mode: 'PIECE',
            unit: undefined,
            qty_scale: 1,
            qty_step: 1,
        });
        expect(
            measureFields({ sold_as: 'QUANTITY', unit: 'pcs', qty_scale: '', qty_step: '' })
        ).toMatchObject({ stock_mode: 'QUANTITY', unit: 'PCS', qty_scale: 1 });
    });
});

describe('valuesToProductRequest', () => {
    it('a new product sends how it is sold and no status', () => {
        const request = valuesToProductRequest(valid());
        expect(request).toMatchObject({ stock_mode: 'QUANTITY', qty_scale: 1, qty_step: 1 });
        expect(request).not.toHaveProperty('status');
        expect(request).not.toHaveProperty('unit');
        expect(request).not.toHaveProperty('slug');
    });

    it('sends only languages with a name, Hindi first', () => {
        const values = valid();
        values.translations.en.name = 'Red kurta';
        expect(valuesToProductRequest(values).translations?.map((x) => x.locale)).toEqual([
            'hi',
            'en',
        ]);
        values.translations.hi.name = '  ';
        expect(valuesToProductRequest(values).translations?.map((x) => x.locale)).toEqual(['en']);
    });

    it('empty rich text and empty blocks are not sent as markup', () => {
        const values = valid();
        values.translations.hi.description_html = '<p></p>';
        values.translations.hi.content_blocks = [
            { code: 'care', html: '<p>धोएँ</p>' },
            { code: 'story', html: '<p> </p>' },
        ];
        const [hi] = valuesToProductRequest(values).translations ?? [];
        expect(hi?.description_html).toBeNull();
        expect(hi?.content_blocks).toEqual([{ code: 'care', html: '<p>धोएँ</p>' }]);
    });

    it('converts typed numbers once', () => {
        const [variant] = valuesToProductRequest(valid()).variants ?? [];
        expect(variant).toMatchObject({ sku: 'KURTA', price: 999, mrp: 1299, position: 0 });
        expect(variant).not.toHaveProperty('package_session_id');
        expect(variant).not.toHaveProperty('barcode');
        expect(variant?.stock_policy).toBe('TRACKED');
    });

    it('a blank price is left out, never sent as zero', () => {
        const values = valid();
        values.variants = [{ ...emptyVariant(), sku: 'KURTA' }];
        const [variant] = valuesToProductRequest(values).variants ?? [];
        expect(variant).not.toHaveProperty('price');
        expect(variant).not.toHaveProperty('mrp');
    });

    it('a saved variant keeps its id, never sends its policy, and can clear its barcode', () => {
        const original = product();
        const values = productToValues(original);
        const first = values.variants[0];
        if (!first) throw new Error('fixture');
        first.barcode = '';
        const [variant] = valuesToProductRequest(values, original).variants ?? [];
        expect(variant).toMatchObject({ package_session_id: 'ps-s', barcode: '' });
        expect(variant).not.toHaveProperty('stock_policy');
    });

    it('a retired variant is sent as ARCHIVED, not left out', () => {
        const original = product();
        const request = valuesToProductRequest(productToValues(original), original);
        expect(request.variants).toHaveLength(2);
        expect(request.variants?.[1]).toMatchObject({
            package_session_id: 'ps-m',
            status: 'ARCHIVED',
        });
    });

    it('lead time goes only with "do not track"', () => {
        const values = valid();
        values.variants = [
            { ...emptyVariant(), sku: 'A', lead_time_days: '5', stock_policy: 'TRACKED' },
            { ...emptyVariant(), sku: 'B', lead_time_days: '5', stock_policy: 'UNTRACKED' },
        ];
        const [tracked, untracked] = valuesToProductRequest(values).variants ?? [];
        expect(tracked).not.toHaveProperty('lead_time_days');
        expect(untracked).toMatchObject({ lead_time_days: 5, stock_policy: 'UNTRACKED' });
    });

    it('an unchanged product does not resend stock_mode, unit or qty_scale', () => {
        const original = product({ published_at: '2026-11-01T00:00:00' });
        const request = valuesToProductRequest(productToValues(original), original);
        expect(request).not.toHaveProperty('stock_mode');
        expect(request).not.toHaveProperty('unit');
        expect(request).not.toHaveProperty('qty_scale');
        expect(request).not.toHaveProperty('qty_step');
    });

    it('a product stored without qty_scale is not sent qty_scale 1', () => {
        const original = product({ qty_scale: null, qty_step: null, unit: null });
        const request = valuesToProductRequest(productToValues(original), original);
        expect(request).not.toHaveProperty('qty_scale');
        expect(request).not.toHaveProperty('qty_step');
    });

    it('changing a draft to "sold by length" sends the new measure', () => {
        const original = product();
        const values = {
            ...productToValues(original),
            sold_as: 'MEASURED' as const,
            unit: 'mtr',
            qty_scale: '10',
            qty_step: '0.5',
        };
        expect(valuesToProductRequest(values, original)).toMatchObject({
            unit: 'MTR',
            qty_scale: 10,
            qty_step: 5,
        });
    });

    it('clearing the tax class or origin sends an empty string', () => {
        const original = product();
        const values = { ...productToValues(original), tax_class_id: '', origin_location_id: '' };
        expect(valuesToProductRequest(values, original)).toMatchObject({
            tax_class_id: '',
            origin_location_id: '',
        });
    });

    it('lists replace the stored set', () => {
        const original = product();
        const values = {
            ...productToValues(original),
            collection_ids: [],
            attribute_value_ids: ['a', 'b'],
        };
        expect(valuesToProductRequest(values, original)).toMatchObject({
            collection_ids: [],
            attribute_value_ids: ['a', 'b'],
            option_attribute_ids: ['size'],
        });
    });

    it('SEO text is sent per language and an empty one clears it', () => {
        const original = product();
        expect(valuesToProductRequest(productToValues(original), original).seo_i18n).toEqual({
            hi: { title: 'लाल कुर्ता', description: 'हाथ से बुना' },
        });
        expect(valuesToProductRequest(valid()).seo_i18n).toEqual({});
    });

    it('lower-cases the slug as the server stores it', () => {
        expect(valuesToProductRequest(valid({ slug: ' Lal-Kurta ' })).slug).toBe('lal-kurta');
    });

    it('round trip: load, change nothing, save keeps the texts', () => {
        const original = product();
        const request = valuesToProductRequest(productToValues(original), original);
        expect(request.translations?.find((x) => x.locale === 'en')).toEqual(
            original.translations[0]
        );
        expect(request.brand).toBe('Example Brand');
        expect(request.slug).toBe('lal-kurta');
    });
});

describe('product schema', () => {
    it('accepts a minimal draft', () => {
        expect(paths(valid())).toEqual([]);
    });

    it('needs a name in at least one language', () => {
        const values = valid();
        values.translations.hi.name = '';
        expect(paths(values)).toEqual(['translations.hi.name']);
        values.translations.en.name = 'Red kurta';
        expect(paths(values)).toEqual([]);
    });

    it('a language with text but no name is refused before the text is lost', () => {
        const values = valid();
        values.translations.en.description_html = '<p>Soft cotton</p>';
        expect(paths(values)).toEqual(['translations.en.name']);
    });

    it('slug: letters of any script, digits, single hyphens', () => {
        expect(paths(valid({ slug: 'लाल-कुर्ता-2' }))).toEqual([]);
        expect(paths(valid({ slug: 'lal--kurta' }))).toEqual(['slug']);
        expect(paths(valid({ slug: 'lal kurta' }))).toEqual(['slug']);
    });

    it('MRP below price is refused on the MRP cell', () => {
        const values = valid();
        values.variants = [{ ...emptyVariant(), sku: 'K', price: '999', mrp: '899' }];
        expect(paths(values)).toEqual(['variants.0.mrp']);
    });

    it('money has at most two decimals', () => {
        const values = valid();
        values.variants = [{ ...emptyVariant(), sku: 'K', price: '9.999' }];
        expect(paths(values)).toEqual(['variants.0.price']);
    });

    it('every row needs a SKU and no SKU twice', () => {
        const values = valid({ option_attribute_ids: ['size'] });
        values.variants = [
            { ...emptyVariant({ size: 's' }), sku: 'K' },
            { ...emptyVariant({ size: 'm' }), sku: 'K' },
            { ...emptyVariant({ size: 'l' }), sku: '' },
        ];
        expect(paths(values).sort()).toEqual([
            'variants.0.sku',
            'variants.1.sku',
            'variants.2.sku',
        ]);
    });

    it('two live rows cannot hold the same option values', () => {
        const values = valid({ option_attribute_ids: ['size'] });
        values.variants = [
            { ...emptyVariant({ size: 's' }), sku: 'A' },
            { ...emptyVariant({ size: 's' }), sku: 'B' },
        ];
        expect(paths(values)).toEqual(['variants.1.sku']);
    });

    it('an archived row is not checked for option values', () => {
        const values = valid({ option_attribute_ids: ['size'] });
        values.variants = [
            { ...emptyVariant({ size: 's' }), sku: 'A' },
            { ...emptyVariant({}), sku: 'OLD', status: 'ARCHIVED' },
        ];
        expect(paths(values)).toEqual([]);
    });

    it('needs one row that is not archived', () => {
        const values = valid();
        values.variants = [{ ...emptyVariant(), sku: 'A', status: 'ARCHIVED' }];
        expect(paths(values)).toEqual(['variants']);
    });

    it('one-of-a-kind pieces are always tracked', () => {
        const values = valid({ sold_as: 'PIECE' });
        values.variants = [{ ...emptyVariant(), sku: 'A', stock_policy: 'UNTRACKED' }];
        expect(paths(values)).toEqual(['variants.0.stock_policy']);
    });

    it('goods sold by length need a smallest step', () => {
        expect(paths(valid({ sold_as: 'MEASURED', qty_step: '' }))).toEqual(['qty_step']);
        expect(paths(valid({ sold_as: 'MEASURED', qty_step: '0' }))).toEqual(['qty_step']);
        expect(paths(valid({ sold_as: 'MEASURED', qty_step: '5', qty_scale: '1.5' }))).toEqual([
            'qty_scale',
        ]);
        expect(paths(valid({ sold_as: 'MEASURED', qty_step: '5', qty_scale: '10' }))).toEqual([]);
    });

    it('the smallest cut is typed in metres and refused, not rounded, past the scale (WP-44 FA2)', () => {
        expect(stepToBase('0.5', '10')).toBe(5);
        expect(stepToBase('0,5', '')).toBe(5);
        expect(stepToBase('0.05', '100')).toBe(5);
        expect(stepToBase('0.55', '10')).toBeNull();
        expect(paths(valid({ sold_as: 'MEASURED', qty_step: '0.55', qty_scale: '10' }))).toEqual(['qty_step']);
        expect(paths(valid({ sold_as: 'MEASURED', qty_step: '0.5', qty_scale: '10' }))).toEqual([]);
    });

    it('sold by length needs 10, 100 or 1000 parts in a unit (D2)', () => {
        expect(paths(valid({ sold_as: 'MEASURED', qty_step: '1', qty_scale: '1' }))).toEqual(['qty_scale']);
        expect(paths(valid({ sold_as: 'MEASURED', qty_step: '1', qty_scale: '4' }))).toEqual(['qty_scale']);
        expect(paths(valid({ sold_as: 'MEASURED', qty_step: '1', qty_scale: '100' }))).toEqual([]);
        // 999 a unit does not split into 1000 paise parts: only the prices are refused, not the scale.
        expect(paths(valid({ sold_as: 'MEASURED', qty_step: '1', qty_scale: '1000' }))).not.toContain('qty_scale');
        expect(paths(valid({ sold_as: 'MEASURED', qty_step: '1', qty_scale: '' }))).toEqual([]);
    });

    it('a saved step of 5 tenths opens as "0.5" and saves back unchanged', () => {
        const original = product({ stock_mode: 'QUANTITY', unit: 'MTR', qty_scale: 10, qty_step: 5 });
        const values = productToValues(original);
        expect(values.qty_step).toBe('0.5');
        expect(valuesToProductRequest(values, original)).not.toHaveProperty('qty_step');
    });

    it('content block codes are lower-case codes, once per language', () => {
        const values = valid();
        values.translations.hi.content_blocks = [
            { code: 'care', html: '<p>a</p>' },
            { code: 'Care Notes', html: '<p>b</p>' },
            { code: 'care', html: '<p>c</p>' },
        ];
        expect(paths(values)).toEqual([
            'translations.hi.content_blocks.1.code',
            'translations.hi.content_blocks.2.code',
        ]);
    });

    it('at most three options', () => {
        expect(paths(valid({ option_attribute_ids: ['a', 'b', 'c', 'd'] }))).toContain(
            'option_attribute_ids'
        );
    });
});

describe('translation helpers', () => {
    it('knows when a language has any text', () => {
        const values = emptyProductValues().translations.en;
        expect(translationHasText(values)).toBe(false);
        expect(translationHasText({ ...values, description_html: '<p>&nbsp;</p>' })).toBe(false);
        expect(translationHasText({ ...values, seo_title: 'x' })).toBe(true);
    });

    it('complete means a name and a description', () => {
        const values = emptyProductValues().translations.hi;
        expect(translationIsComplete({ ...values, name: 'कुर्ता' })).toBe(false);
        expect(
            translationIsComplete({ ...values, name: 'कुर्ता', description_html: '<p>सूती</p>' })
        ).toBe(true);
    });
});

describe('publishBlockers', () => {
    it('a GST-registered shop cannot publish without a tax class', () => {
        expect(publishBlockers(valid(), 'REGULAR')).toEqual(['taxClassMissing']);
        expect(publishBlockers(valid({ tax_class_id: 'tax-1' }), 'REGULAR')).toEqual([]);
    });

    it('other tax modes do not need one', () => {
        expect(publishBlockers(valid(), 'COMPOSITION')).toEqual([]);
        expect(publishBlockers(valid(), 'UNREGISTERED')).toEqual([]);
    });

    it('an unknown tax mode is left to the server', () => {
        expect(publishBlockers(valid(), null)).toEqual([]);
    });

    it('needs an active variant with a price', () => {
        const noPrice = valid();
        noPrice.variants = [{ ...emptyVariant(), sku: 'K' }];
        expect(publishBlockers(noPrice, 'UNREGISTERED')).toEqual(['priceMissing']);
        const noneActive = valid();
        noneActive.variants = [{ ...emptyVariant(), sku: 'K', price: '9', status: 'DRAFT' }];
        expect(publishBlockers(noneActive, 'UNREGISTERED')).toEqual(['noActiveVariant']);
    });

    it('lists every blocker at once', () => {
        const values = emptyProductValues();
        expect(publishBlockers(values, 'REGULAR')).toEqual([
            'nameMissing',
            'taxClassMissing',
            'priceMissing',
        ]);
    });
});

describe('goods sold by measure are priced per unit', () => {
    const fabric = (): ProductDetail => {
        const base = product({ unit: 'MTR', qty_scale: 10, qty_step: 5 });
        // Stored: 45.00 for one base unit (10 cm), MRP 50.00.
        base.variants = base.variants.map((variant) => ({ ...variant, price: 45, mrp: 50 }));
        return base;
    };

    it('shows the stored price of a base unit as the price of a metre', () => {
        const values = productToValues(fabric());
        expect(values.sold_as).toBe('MEASURED');
        expect(values.variants[0]?.price).toBe('450');
        expect(values.variants[0]?.mrp).toBe('500');
    });

    it('450 typed for a metre is sent as 45 for a tenth of a metre, not as 450', () => {
        const values = valid({ sold_as: 'MEASURED', unit: 'MTR', qty_scale: '10', qty_step: '5' });
        values.variants = [{ ...emptyVariant(), sku: 'CLOTH-ROLL', price: '450', mrp: '500.5' }];
        const request = valuesToProductRequest(values);
        expect(request.variants?.[0]).toMatchObject({ price: 45, mrp: 50.05 });
        // 2.5 m is 25 base units: 25 x 45 = 1,125, not 11,250.
        expect((request.variants?.[0]?.price ?? 0) * 25).toBe(1125);
    });

    it('load, change nothing, save: the stored price is unchanged', () => {
        const original = fabric();
        const request = valuesToProductRequest(productToValues(original), original);
        expect(request.variants?.map((variant) => [variant.price, variant.mrp])).toEqual(
            original.variants.map((variant) => [variant.price, variant.mrp])
        );
    });

    it('goods sold by the piece are sent as typed', () => {
        const request = valuesToProductRequest(valid());
        expect(request.variants?.[0]).toMatchObject({ price: 999, mrp: 1299 });
        expect(priceScaleOf(valid())).toBe(1);
    });

    it('a price per metre that has no price to the paisa for a base unit is refused', () => {
        const values = valid({ sold_as: 'MEASURED', unit: 'MTR', qty_scale: '10', qty_step: '5' });
        values.variants = [{ ...emptyVariant(), sku: 'CLOTH-ROLL', price: '449.99', mrp: '500' }];
        expect(paths(values)).toEqual(['variants.0.price']);
        expect(dividesToPaise('449.99', 10)).toBe(false);
        expect(dividesToPaise('450', 10)).toBe(true);
        expect(dividesToPaise('449.99', 1)).toBe(true);
        expect(dividesToPaise('', 10)).toBe(true);
    });

    it('converts in whole paise, without float drift', () => {
        expect(perUnitToBase(1299.9, 10)).toBe(129.99);
        expect(baseToPerUnit(129.99, 10)).toBe(1299.9);
        expect(baseToPerUnit(0.07, 100)).toBe(7);
        expect(baseToPerUnit(null, 10)).toBeNull();
        expect(perUnitToBase(450, 1)).toBe(450);
    });
});
