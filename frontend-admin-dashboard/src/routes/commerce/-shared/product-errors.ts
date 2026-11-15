import type { CommerceErrorCode } from './commerce-errors';

/**
 * Where a refusal of the product endpoints belongs on the editor.
 *
 * The server answers with one English sentence and no field name
 * (`CommerceProductService`, `CatalogueRules`, `CommerceTaxClassService`).
 * This module reads that sentence and answers: which form field it is about,
 * and, for the refusals staff meet every day, the key of a translated
 * sentence to show instead (Hindi first). A sentence it does
 * not know is shown as the server wrote it, on the form as a whole.
 */

export interface VariantRef {
    sku: string;
    barcode: string;
}

export interface MappedProductError {
    /** react-hook-form path, or null for the form as a whole. */
    field: string | null;
    /** Key under `products.serverErrors` for a translated sentence, when known. */
    key: string | null;
    /** Values for the translated sentence. */
    params: Record<string, string>;
    /** The server's own sentence: the fallback, and always kept for support. */
    message: string;
}

const variantIndex = (variants: VariantRef[], field: keyof VariantRef, value: string): number =>
    variants.findIndex((row) => row[field].trim() === value.trim());

const variantField = (
    variants: VariantRef[],
    by: keyof VariantRef,
    value: string,
    cell: string
): string => {
    const index = variantIndex(variants, by, value);
    return index >= 0 ? `variants.${index}.${cell}` : 'variants';
};

type Rule = (message: string, variants: VariantRef[]) => Omit<MappedProductError, 'message'> | null;

const simple =
    (pattern: RegExp, field: string | null, key: string | null = null): Rule =>
    (message) =>
        pattern.test(message) ? { field, key, params: {} } : null;

const RULES: Rule[] = [
    // Tax (CommerceTaxClassService)
    simple(/needs a tax class before it is published/i, 'tax_class_id', 'taxClassMissing'),
    simple(/tax class of the product has no rate in force/i, 'tax_class_id', 'taxClassNoRate'),
    simple(/tax class/i, 'tax_class_id'),
    // Product fields
    (message) => {
        const match = /Another product already uses the slug (.+)$/i.exec(message);
        return match ? { field: 'slug', key: 'slugTaken', params: { slug: match[1] ?? '' } } : null;
    },
    simple(/^slug may hold/i, 'slug', 'slugFormat'),
    simple(/cannot change after the product has been published/i, 'sold_as', 'measureLocked'),
    simple(
        /origin_location_id must be a source location/i,
        'origin_location_id',
        'originNotSource'
    ),
    simple(/origin_location_id/i, 'origin_location_id'),
    simple(/^qty_scale/i, 'qty_scale'),
    simple(/^qty_step/i, 'qty_step'),
    simple(/^unit is too long/i, 'unit'),
    simple(/^brand is too long/i, 'brand'),
    simple(/unknown collection/i, 'collection_ids'),
    simple(/unknown attribute value|attribute_value_ids/i, 'attribute_value_ids'),
    simple(/unknown attribute|option_attribute_ids/i, 'option_attribute_ids'),
    // Translations
    simple(
        /needs at least one translation with a name|a translation needs a name/i,
        'translations.hi.name',
        'nameMissing'
    ),
    simple(/a product name is at most/i, 'translations.hi.name'),
    // Variants, named by SKU or barcode in the sentence
    (message, variants) => {
        const match =
            /(?:Another variant already uses|two variants of the product have) the sku (.+)$/i.exec(
                message
            );
        if (!match) return null;
        const sku = match[1] ?? '';
        return {
            field: variantField(variants, 'sku', sku, 'sku'),
            key: 'skuTaken',
            params: { sku },
        };
    },
    (message, variants) => {
        const match =
            /(?:Another variant already uses|two variants of the product have) the barcode (.+)$/i.exec(
                message
            );
        if (!match) return null;
        const barcode = match[1] ?? '';
        return {
            field: variantField(variants, 'barcode', barcode, 'barcode'),
            key: 'barcodeTaken',
            params: { barcode },
        };
    },
    (message, variants) => {
        const match = /^variants (.+) and (.+) have the same option values$/i.exec(message);
        if (!match) return null;
        const sku = match[2] ?? '';
        return {
            field: variantField(variants, 'sku', sku, 'sku'),
            key: 'sameOptionValues',
            params: { first: match[1] ?? '', second: sku },
        };
    },
    (message, variants) => {
        const match =
            /^variant (.+?) (needs a price|must be TRACKED|must have exactly one value|has a value that does not belong)/i.exec(
                message
            );
        if (!match) return null;
        const sku = match[1] ?? '';
        const what = (match[2] ?? '').toLowerCase();
        if (what.startsWith('needs a price')) {
            return {
                field: variantField(variants, 'sku', sku, 'price'),
                key: 'priceMissing',
                params: { sku },
            };
        }
        if (what.startsWith('must be tracked')) {
            return {
                field: variantField(variants, 'sku', sku, 'stock_policy'),
                key: 'pieceTracked',
                params: { sku },
            };
        }
        return {
            field: variantField(variants, 'sku', sku, 'sku'),
            key: 'optionValues',
            params: { sku },
        };
    },
    simple(/at least one active variant/i, 'variants', 'noActiveVariant'),
    simple(/at least one variant is required/i, 'variants', 'noActiveVariant'),
    simple(/^mrp cannot be below the price/i, 'variants', 'mrpBelowPrice'),
    simple(/stock_policy of an existing variant cannot be changed/i, 'variants', 'policyLocked'),
    simple(/^sku is (required|at most)/i, 'variants', 'skuRequired'),
    simple(
        /^(price|mrp|barcode|lead_time_days|weight_grams|a variant name|currency)\b/i,
        'variants'
    ),
];

/** Refusals of the access guard are about the person, never about a field. */
export function mapProductError(
    message: string,
    variants: VariantRef[],
    code: CommerceErrorCode | null = null
): MappedProductError {
    const sentence = message.trim();
    if (code) return { field: null, key: null, params: {}, message: sentence };
    for (const rule of RULES) {
        const hit = rule(sentence, variants);
        if (hit) return { ...hit, message: sentence };
    }
    return { field: null, key: null, params: {}, message: sentence };
}

/** Every key `mapProductError` can answer; the strings test reads this. */
export const PRODUCT_SERVER_ERROR_KEYS = [
    'taxClassMissing',
    'taxClassNoRate',
    'slugTaken',
    'slugFormat',
    'measureLocked',
    'originNotSource',
    'nameMissing',
    'skuTaken',
    'barcodeTaken',
    'sameOptionValues',
    'priceMissing',
    'pieceTracked',
    'optionValues',
    'noActiveVariant',
    'mrpBelowPrice',
    'policyLocked',
    'skuRequired',
] as const;

// ─── Where a field lives on the editor ───────────────────────────────────────

export type EditorSection = 'details' | 'selling' | 'variants' | 'tax' | 'organise';

/** DOM id of a section card: the target of "go to field". */
export const sectionDomId = (section: EditorSection) => `product-section-${section}`;

/** The section card that holds a form field. */
export function sectionOfField(field: string): EditorSection {
    if (field.startsWith('variants') || field.startsWith('option_')) return 'variants';
    if (field === 'tax_class_id') return 'tax';
    if (['sold_as', 'unit', 'qty_scale', 'qty_step'].includes(field)) return 'selling';
    if (['origin_location_id', 'attribute_value_ids', 'collection_ids'].includes(field)) {
        return 'organise';
    }
    return 'details';
}

/** The language tab a field sits in, when it sits in one. */
export function localeOfField(field: string): 'hi' | 'en' | null {
    const match = /^translations\.(hi|en)\b/.exec(field);
    return match ? (match[1] as 'hi' | 'en') : null;
}

/**
 * The path of the first message in a react-hook-form errors object, in the
 * order the fields are declared ("variants.2.mrp"). An array-level message
 * (`root`) answers the array itself.
 */
export function firstErrorPath(errors: unknown, prefix = ''): string | null {
    if (!errors || typeof errors !== 'object') return null;
    const record = errors as Record<string, unknown>;
    if (typeof record.message === 'string' && 'type' in record) return prefix || null;
    for (const [key, value] of Object.entries(record)) {
        if (key === 'ref') continue;
        const path = key === 'root' ? prefix : prefix ? `${prefix}.${key}` : key;
        const found = firstErrorPath(value, path);
        if (found) return found;
    }
    return null;
}
