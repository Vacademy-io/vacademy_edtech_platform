import type { TFunction } from 'i18next';
import { z } from 'zod';
import type { ProductStatus } from './commerce-types';
import {
    PRODUCT_LOCALES,
    type ContentBlock,
    type ProductDetail,
    type ProductLocale,
    type ProductRequest,
    type StockPolicy,
    type VariantRequest,
} from './catalogue-types';
import { lengthInputText, parseLength } from './units';
import { type Combination, combinationKey, duplicateSkus } from './variant-combinations';

/**
 * Form model of the product editor and its two mappings: product → form and
 * form → request. Numbers are held as the text the person typed and converted
 * once, on save. The whole editor saves in one call.
 */

/** "How it is sold": one choice that sets stock_mode, unit and qty_scale. */
export type SoldAs = 'QUANTITY' | 'PIECE' | 'MEASURED';

export interface TranslationValues {
    name: string;
    short_description: string;
    description_html: string;
    seo_title: string;
    seo_description: string;
    content_blocks: ContentBlock[];
}

export interface VariantValues {
    /** Client id of the row; stable across re-generation. */
    key: string;
    /** Empty until the variant is saved. */
    package_session_id: string;
    /** Scan code made by the server; shown, never sent. */
    label_code: string;
    name: string;
    sku: string;
    barcode: string;
    price: string;
    mrp: string;
    weight_grams: string;
    stock_policy: StockPolicy;
    lead_time_days: string;
    status: ProductStatus;
    option_values: Combination;
}

export interface ProductFormValues {
    slug: string;
    brand: string;
    sold_as: SoldAs;
    unit: string;
    qty_scale: string;
    qty_step: string;
    tax_class_id: string;
    origin_location_id: string;
    translations: Record<ProductLocale, TranslationValues>;
    option_attribute_ids: string[];
    /** Ticked values per option attribute: what the grid is generated from. */
    option_value_ids: Record<string, string[]>;
    attribute_value_ids: string[];
    collection_ids: string[];
    variants: VariantValues[];
}

export const DEFAULT_MEASURE_UNIT = 'MTR';
export const DEFAULT_MEASURE_SCALE = '10';
/** Parts in one unit that goods sold by length may use (WP-44 D2): 1 is for counted goods only. */
export const MEASURE_SCALES = [10, 100, 1000] as const;

/** The scale the smallest cut is read with: the typed one when allowed, else the default 10. */
export const measureScaleOf = (raw: string): number => {
    const n = Number(raw.trim());
    return (MEASURE_SCALES as readonly number[]).includes(n) ? n : Number(DEFAULT_MEASURE_SCALE);
};

/**
 * The smallest cut typed in units ("0.5" m) → base units (5 at scale 10), or
 * null when it is blank, not a number, has more decimals than the scale holds
 * ("0.55" at scale 10) or is 0.
 */
export function stepToBase(raw: string, scaleRaw: string): number | null {
    if (raw.trim() === '') return null;
    const parsed = parseLength(raw, measureScaleOf(scaleRaw));
    return 'stored' in parsed && parsed.stored >= 1 ? parsed.stored : null;
}

const EMPTY_TRANSLATION: TranslationValues = {
    name: '',
    short_description: '',
    description_html: '',
    seo_title: '',
    seo_description: '',
    content_blocks: [],
};

let rowCounter = 0;
export const newRowKey = () => `row-${Date.now().toString(36)}-${(rowCounter += 1)}`;

export const emptyVariant = (optionValues: Combination = {}): VariantValues => ({
    key: newRowKey(),
    package_session_id: '',
    label_code: '',
    name: '',
    sku: '',
    barcode: '',
    price: '',
    mrp: '',
    weight_grams: '',
    stock_policy: 'TRACKED',
    lead_time_days: '',
    status: 'ACTIVE',
    option_values: optionValues,
});

/** A new product: one default variant, nothing pre-filled. */
export const emptyProductValues = (): ProductFormValues => ({
    slug: '',
    brand: '',
    sold_as: 'QUANTITY',
    unit: '',
    qty_scale: '',
    qty_step: '',
    tax_class_id: '',
    origin_location_id: '',
    translations: { hi: { ...EMPTY_TRANSLATION }, en: { ...EMPTY_TRANSLATION } },
    option_attribute_ids: [],
    option_value_ids: {},
    attribute_value_ids: [],
    collection_ids: [],
    variants: [emptyVariant()],
});

const text = (value: number | null | undefined) =>
    value === null || value === undefined ? '' : String(value);

const seoOf = (seo: Record<string, unknown> | null, locale: string) => {
    const entry = seo?.[locale];
    const r = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    return {
        seo_title: typeof r.title === 'string' ? r.title : '',
        seo_description: typeof r.description === 'string' ? r.description : '',
    };
};

export function soldAsOf(product: Pick<ProductDetail, 'stock_mode' | 'qty_scale'>): SoldAs {
    if (product.stock_mode === 'PIECE') return 'PIECE';
    return (product.qty_scale ?? 1) > 1 ? 'MEASURED' : 'QUANTITY';
}

export function productToValues(product: ProductDetail): ProductFormValues {
    const translations = PRODUCT_LOCALES.reduce(
        (out, locale) => {
            const found = product.translations.find((entry) => entry.locale === locale);
            out[locale] = {
                name: found?.name ?? '',
                short_description: found?.short_description ?? '',
                description_html: found?.description_html ?? '',
                content_blocks: found?.content_blocks.map((block) => ({ ...block })) ?? [],
                ...seoOf(product.seo_i18n, locale),
            };
            return out;
        },
        {} as Record<ProductLocale, TranslationValues>
    );
    const live = product.variants.filter((variant) => variant.status !== 'ARCHIVED');
    const optionValueIds = product.option_attribute_ids.reduce<Record<string, string[]>>(
        (out, attributeId) => {
            out[attributeId] = [
                ...new Set(
                    live.map((variant) => variant.option_values[attributeId]).filter(Boolean)
                ),
            ] as string[];
            return out;
        },
        {}
    );
    // A measured product shows its prices per unit (a metre), not per base unit.
    const priceScale = soldAsOf(product) === 'MEASURED' ? product.qty_scale ?? 1 : 1;
    return {
        slug: product.slug ?? '',
        brand: product.brand ?? '',
        sold_as: soldAsOf(product),
        unit: product.unit ?? '',
        qty_scale: text(product.qty_scale),
        // A measured product's smallest cut is shown in units ("0.5" m), stored in base units (5).
        qty_step:
            soldAsOf(product) === 'MEASURED' && product.qty_step
                ? lengthInputText(product.qty_step, product.qty_scale)
                : text(product.qty_step),
        tax_class_id: product.tax_class_id ?? '',
        origin_location_id: product.origin_location_id ?? '',
        translations,
        option_attribute_ids: [...product.option_attribute_ids],
        option_value_ids: optionValueIds,
        attribute_value_ids: [...product.attribute_value_ids],
        collection_ids: [...product.collection_ids],
        variants: product.variants.map((variant) => ({
            key: variant.package_session_id,
            package_session_id: variant.package_session_id,
            label_code: variant.label_code ?? '',
            name: variant.name ?? '',
            sku: variant.sku ?? '',
            barcode: variant.barcode ?? '',
            price: text(baseToPerUnit(variant.price, priceScale)),
            mrp: text(baseToPerUnit(variant.mrp, priceScale)),
            weight_grams: text(variant.weight_grams),
            stock_policy: variant.stock_policy === 'UNTRACKED' ? 'UNTRACKED' : 'TRACKED',
            lead_time_days: text(variant.lead_time_days),
            status: (['DRAFT', 'ACTIVE', 'ARCHIVED'] as const).includes(
                variant.status as ProductStatus
            )
                ? (variant.status as ProductStatus)
                : 'ACTIVE',
            option_values: { ...variant.option_values },
        })),
    };
}

const numberOrUndefined = (raw: string): number | undefined =>
    raw.trim() === '' ? undefined : Number(raw.trim());

/**
 * Measured goods (cloth by the metre). The manager types the price of one
 * unit (a metre); the server stores the price of one base unit (a tenth of a
 * metre at scale 10). These three convert between the two in whole paise, so
 * 450 a metre is sent as 45 and never as 450 for 10 cm.
 */
const toPaise = (amount: number) => Math.round(amount * 100);

/** True when a price per unit splits into `scale` equal parts to the paisa. */
export const dividesToPaise = (raw: string, scale: number): boolean => {
    if (raw.trim() === '' || scale <= 1) return true;
    const amount = Number(raw.trim());
    return Number.isFinite(amount) && toPaise(amount) % scale === 0;
};

/** What is typed (per unit) to what is sent (per base unit). */
export const perUnitToBase = (perUnit: number, scale: number): number =>
    scale <= 1 ? perUnit : Math.round(toPaise(perUnit) / scale) / 100;

/** What is stored (per base unit) to what is shown (per unit). */
export const baseToPerUnit = (
    perBase: number | null | undefined,
    scale: number
): number | null | undefined =>
    perBase === null || perBase === undefined || scale <= 1
        ? perBase
        : Math.round(toPaise(perBase) * scale) / 100;

/** Base units per unit of what the form describes: above 1 only for measured goods. */
export const priceScaleOf = (
    values: Pick<ProductFormValues, 'sold_as' | 'unit' | 'qty_scale' | 'qty_step'>
): number => (values.sold_as === 'MEASURED' ? measureFields(values).qty_scale : 1);

/** True for markup with no text in it (`<p></p>`, `&nbsp;`). */
export const isBlankHtml = (html: string) => html.replace(/<[^>]*>|&nbsp;|\s/g, '') === '';

/** True when the language has any text at all (so it needs a name). */
export const translationHasText = (values: TranslationValues): boolean =>
    [values.name, values.short_description, values.seo_title, values.seo_description].some(
        (entry) => entry.trim() !== ''
    ) ||
    !isBlankHtml(values.description_html) ||
    values.content_blocks.some((block) => !isBlankHtml(block.html));

/** Name and description present: the green dot on the language tab. */
export const translationIsComplete = (values: TranslationValues): boolean =>
    values.name.trim() !== '' && !isBlankHtml(values.description_html);

function variantToRequest(
    row: VariantValues,
    position: number,
    priceScale: number
): VariantRequest {
    const saved = row.package_session_id !== '';
    const request: VariantRequest = {
        sku: row.sku.trim(),
        position,
        status: row.status,
        option_values: { ...row.option_values },
    };
    if (saved) request.package_session_id = row.package_session_id;
    if (row.name.trim()) request.name = row.name.trim();
    // On a saved variant an empty barcode clears it; a new one simply has none.
    if (saved || row.barcode.trim()) request.barcode = row.barcode.trim();
    // The policy of a saved variant cannot change yet (the server refuses it).
    if (!saved) request.stock_policy = row.stock_policy;
    const typedPrice = numberOrUndefined(row.price);
    const typedMrp = numberOrUndefined(row.mrp);
    const price = typedPrice === undefined ? undefined : perUnitToBase(typedPrice, priceScale);
    const mrp = typedMrp === undefined ? undefined : perUnitToBase(typedMrp, priceScale);
    if (price !== undefined) request.price = price;
    if (mrp !== undefined) request.mrp = mrp;
    else if (price !== undefined && saved) request.mrp = price; // MRP follows the price
    const weight = numberOrUndefined(row.weight_grams);
    if (weight !== undefined) request.weight_grams = weight;
    const lead = numberOrUndefined(row.lead_time_days);
    if (row.stock_policy === 'UNTRACKED' && lead !== undefined) request.lead_time_days = lead;
    return request;
}

/** stock_mode, unit, qty_scale, qty_step for the chosen "how it is sold". */
export function measureFields(
    values: Pick<ProductFormValues, 'sold_as' | 'unit' | 'qty_scale' | 'qty_step'>
): Required<Pick<ProductRequest, 'stock_mode' | 'qty_scale' | 'qty_step'>> &
    Pick<ProductRequest, 'unit'> {
    if (values.sold_as === 'MEASURED') {
        return {
            stock_mode: 'QUANTITY',
            unit: (values.unit.trim() || DEFAULT_MEASURE_UNIT).toUpperCase(),
            qty_scale: numberOrUndefined(values.qty_scale) ?? Number(DEFAULT_MEASURE_SCALE),
            // Typed in units; validation refuses anything that is not a whole number of base units.
            qty_step: stepToBase(values.qty_step, values.qty_scale) ?? 1,
        };
    }
    return {
        stock_mode: values.sold_as === 'PIECE' ? 'PIECE' : 'QUANTITY',
        unit: values.unit.trim() ? values.unit.trim().toUpperCase() : undefined,
        qty_scale: 1,
        qty_step: 1,
    };
}

/**
 * The request for POST (no `original`) or PUT /products/{id}.
 *
 * - Translations: only languages that have a name are sent, Hindi first (the
 *   server takes the legacy name from the first one). A language is never
 *   removed by leaving it out.
 * - stock_mode, unit and qty_scale cannot change once the product has been
 *   published, so on an update they are sent only when they differ from what
 *   is stored.
 * - Lists (options, facets, collections) replace the stored set. Variants are
 *   added or updated, never removed: a row to retire is sent as ARCHIVED.
 * - `status` is never sent here; publish and archive are their own call.
 */
export function valuesToProductRequest(
    values: ProductFormValues,
    original?: ProductDetail | null
): ProductRequest {
    const request: ProductRequest = {
        brand: values.brand.trim(),
        tax_class_id: values.tax_class_id,
        origin_location_id: values.origin_location_id,
        option_attribute_ids: [...values.option_attribute_ids],
        attribute_value_ids: [...values.attribute_value_ids],
        collection_ids: [...values.collection_ids],
    };
    // A blank slug on a new product lets the server make one from the name.
    if (values.slug.trim()) request.slug = values.slug.trim().toLowerCase();

    const measure = measureFields(values);
    if (!original) {
        Object.assign(request, measure);
        if (measure.unit === undefined) delete request.unit;
    } else {
        if (measure.stock_mode !== original.stock_mode) request.stock_mode = measure.stock_mode;
        if (measure.unit !== undefined && measure.unit !== original.unit) {
            request.unit = measure.unit;
        }
        if (measure.qty_scale !== (original.qty_scale ?? 1)) request.qty_scale = measure.qty_scale;
        if (measure.qty_step !== (original.qty_step ?? 1)) request.qty_step = measure.qty_step;
    }

    request.translations = PRODUCT_LOCALES.filter(
        (locale) => values.translations[locale].name.trim() !== ''
    ).map((locale) => {
        const entry = values.translations[locale];
        return {
            locale,
            name: entry.name.trim(),
            short_description: entry.short_description.trim() || null,
            description_html: isBlankHtml(entry.description_html) ? null : entry.description_html,
            content_blocks: entry.content_blocks
                .filter((block) => block.code.trim() !== '' && !isBlankHtml(block.html))
                .map((block) => ({ code: block.code.trim(), html: block.html })),
        };
    });

    request.seo_i18n = PRODUCT_LOCALES.reduce<NonNullable<ProductRequest['seo_i18n']>>(
        (out, locale) => {
            const { seo_title: title, seo_description: description } = values.translations[locale];
            if (title.trim() || description.trim()) {
                out[locale] = {
                    ...(title.trim() ? { title: title.trim() } : {}),
                    ...(description.trim() ? { description: description.trim() } : {}),
                };
            }
            return out;
        },
        {}
    );

    const priceScale = priceScaleOf(values);
    request.variants = values.variants.map((row, position) =>
        variantToRequest(row, position, priceScale)
    );
    return request;
}

// ─── Validation ──────────────────────────────────────────────────────────────

/** Letters of any script, digits and single hyphens: the server's slug rule. */
export const SLUG_PATTERN = /^[\p{L}\p{M}\p{N}]+(-[\p{L}\p{M}\p{N}]+)*$/u;
const MONEY = /^(\d{1,10}(\.\d{1,2})?)?$/;
const WHOLE = /^\d{0,9}$/;
export const BLOCK_CODE = /^[a-z0-9]+(_[a-z0-9]+)*$/;

const translationSchema = z.object({
    name: z.string().max(255),
    short_description: z.string(),
    description_html: z.string(),
    seo_title: z.string(),
    seo_description: z.string(),
    content_blocks: z.array(z.object({ code: z.string(), html: z.string() })),
});

/**
 * What the form checks before the server is asked. The server checks all of it
 * again and more (unique slug, SKU and barcode; tax class in force).
 */
export const buildProductSchema = (t: TFunction) =>
    z
        .object({
            slug: z
                .string()
                .trim()
                .max(200, t('products.validation.slug'))
                .refine((slug) => slug === '' || SLUG_PATTERN.test(slug), {
                    message: t('products.validation.slug'),
                }),
            brand: z.string().trim().max(255, t('products.validation.tooLong')),
            sold_as: z.enum(['QUANTITY', 'PIECE', 'MEASURED']),
            unit: z.string().trim().max(32, t('products.validation.tooLong')),
            qty_scale: z.string().trim(),
            qty_step: z.string().trim(),
            tax_class_id: z.string(),
            origin_location_id: z.string(),
            translations: z.object({ hi: translationSchema, en: translationSchema }),
            option_attribute_ids: z.array(z.string()).max(3, t('products.validation.maxOptions')),
            option_value_ids: z.record(z.array(z.string())),
            attribute_value_ids: z.array(z.string()),
            collection_ids: z.array(z.string()),
            variants: z
                .array(
                    z
                        .object({
                            key: z.string(),
                            package_session_id: z.string(),
                            label_code: z.string(),
                            name: z.string().trim().max(255, t('products.validation.tooLong')),
                            sku: z
                                .string()
                                .trim()
                                .min(1, t('products.validation.skuRequired'))
                                .max(100, t('products.validation.tooLong')),
                            barcode: z.string().trim().max(100, t('products.validation.tooLong')),
                            price: z.string().trim().regex(MONEY, t('products.validation.money')),
                            mrp: z.string().trim().regex(MONEY, t('products.validation.money')),
                            weight_grams: z
                                .string()
                                .trim()
                                .regex(WHOLE, t('products.validation.wholeNumber')),
                            stock_policy: z.enum(['TRACKED', 'UNTRACKED']),
                            lead_time_days: z
                                .string()
                                .trim()
                                .regex(WHOLE, t('products.validation.wholeNumber')),
                            status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']),
                            option_values: z.record(z.string()),
                        })
                        .superRefine((row, ctx) => {
                            if (row.price && row.mrp && Number(row.mrp) < Number(row.price)) {
                                ctx.addIssue({
                                    code: z.ZodIssueCode.custom,
                                    path: ['mrp'],
                                    message: t('products.validation.mrpBelowPrice'),
                                });
                            }
                        })
                )
                .min(1, t('products.validation.noVariant')),
        })
        .superRefine((values, ctx) => {
            const issue = (path: (string | number)[], message: string) =>
                ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

            const named = PRODUCT_LOCALES.filter((l) => values.translations[l].name.trim());
            if (named.length === 0) {
                issue(['translations', 'hi', 'name'], t('products.validation.nameRequired'));
            }
            PRODUCT_LOCALES.forEach((locale) => {
                const entry = values.translations[locale];
                if (named.length > 0 && !entry.name.trim() && translationHasText(entry)) {
                    issue(
                        ['translations', locale, 'name'],
                        t('products.validation.nameForLanguage')
                    );
                }
                const codes = new Set<string>();
                entry.content_blocks.forEach((block, index) => {
                    const code = block.code.trim();
                    if (!BLOCK_CODE.test(code) || codes.has(code)) {
                        issue(
                            ['translations', locale, 'content_blocks', index, 'code'],
                            t('products.validation.blockCode')
                        );
                    }
                    codes.add(code);
                });
            });

            if (values.sold_as === 'MEASURED') {
                // Sold by length needs 10, 100 or 1000 parts in a unit (D2); 1 would read back as "by quantity".
                if (values.qty_scale !== '' && !(MEASURE_SCALES as readonly number[]).includes(Number(values.qty_scale))) {
                    issue(['qty_scale'], t('products.validation.measureScale'));
                }
                if (stepToBase(values.qty_step, values.qty_scale) === null) {
                    const parsed = parseLength(values.qty_step, measureScaleOf(values.qty_scale));
                    issue(
                        ['qty_step'],
                        'problem' in parsed && parsed.problem === 'decimals'
                            ? t('products.validation.stepDecimals', {
                                  count: Math.round(Math.log10(measureScaleOf(values.qty_scale))),
                              })
                            : t('products.validation.stepRequired')
                    );
                }
            }

            const priceScale = priceScaleOf(values);
            if (priceScale > 1) {
                values.variants.forEach((row, index) => {
                    (['price', 'mrp'] as const).forEach((field) => {
                        if (
                            MONEY.test(row[field].trim()) &&
                            !dividesToPaise(row[field], priceScale)
                        ) {
                            issue(
                                ['variants', index, field],
                                t('products.validation.priceNotDivisible', { scale: priceScale })
                            );
                        }
                    });
                });
            }

            const live = values.variants.filter((row) => row.status !== 'ARCHIVED');
            const twice = new Set(duplicateSkus(values.variants));
            const combos = new Map<string, number>();
            values.variants.forEach((row, index) => {
                if (twice.has(row.sku.trim())) {
                    issue(['variants', index, 'sku'], t('products.validation.skuTwice'));
                }
                if (values.sold_as === 'PIECE' && row.stock_policy !== 'TRACKED') {
                    issue(
                        ['variants', index, 'stock_policy'],
                        t('products.validation.pieceTracked')
                    );
                }
                if (row.status === 'ARCHIVED') return;
                const key = combinationKey(row.option_values);
                const complete = values.option_attribute_ids.every((id) => row.option_values[id]);
                if (!complete || combos.has(key)) {
                    issue(['variants', index, 'sku'], t('products.validation.optionValues'));
                }
                combos.set(key, index);
            });
            if (values.variants.length > 0 && live.length === 0) {
                issue(['variants'], t('products.validation.noLiveVariant'));
            }
        });

// ─── Publish blockers ────────────────────────────────────────────────────────

export type PublishBlocker = 'taxClassMissing' | 'noActiveVariant' | 'priceMissing' | 'nameMissing';

/** The form field a blocker points at, for the "go to field" link. */
export const BLOCKER_FIELD: Record<PublishBlocker, string> = {
    taxClassMissing: 'tax_class_id',
    noActiveVariant: 'variants',
    priceMissing: 'variants',
    nameMissing: 'translations.hi.name',
};

/**
 * What stops Publish, checked before the server is asked so the person gets
 * one clear list. The tax class is needed only when the shop is GST-registered
 * (tax mode REGULAR); in every other mode no tax line is printed.
 * `taxMode` null means the setting is not known:
 * the server decides.
 */
export function publishBlockers(
    values: ProductFormValues,
    taxMode: string | null | undefined
): PublishBlocker[] {
    const blockers: PublishBlocker[] = [];
    if (PRODUCT_LOCALES.every((locale) => !values.translations[locale].name.trim())) {
        blockers.push('nameMissing');
    }
    if (taxMode === 'REGULAR' && !values.tax_class_id) blockers.push('taxClassMissing');
    const active = values.variants.filter((row) => row.status === 'ACTIVE');
    if (active.length === 0) blockers.push('noActiveVariant');
    else if (active.some((row) => !(Number(row.price) > 0))) blockers.push('priceMissing');
    return blockers;
}
