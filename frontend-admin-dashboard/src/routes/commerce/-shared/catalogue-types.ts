/**
 * Wire types of the catalogue admin API (products, variants, attributes,
 * media, import). Fields are snake_case, as the backend serialises them.
 *
 * Read from the controllers and DTOs of `features/commerce/catalogue` (its
 * `importer` package included) and `features/commerce/media`.
 */
import type { ProductStatus } from './commerce-types';

export type StockMode = 'QUANTITY' | 'PIECE';
export type StockPolicy = 'TRACKED' | 'UNTRACKED';
export type AttributeKind = 'TEXT' | 'SWATCH' | 'SIZE';
export type MediaKind = 'IMAGE' | 'VIDEO';

/** The two languages every product is written in; Hindi first. */
export const PRODUCT_LOCALES = ['hi', 'en'] as const;
export type ProductLocale = (typeof PRODUCT_LOCALES)[number];

export interface ContentBlock {
    code: string;
    html: string;
}

export interface ProductTranslation {
    locale: string;
    name: string;
    short_description: string | null;
    description_html: string | null;
    content_blocks: ContentBlock[];
}

export interface VariantDetail {
    package_session_id: string;
    name: string | null;
    sku: string | null;
    barcode: string | null;
    /** The scan code printed on labels; made by the server, never typed. */
    label_code: string | null;
    stock_policy: StockPolicy | string | null;
    lead_time_days: number | null;
    weight_grams: number | null;
    position: number | null;
    status: ProductStatus | string | null;
    external_ref: string | null;
    price: number | null;
    mrp: number | null;
    currency: string | null;
    /** attribute id → attribute value id. */
    option_values: Record<string, string>;
}

export interface ProductDetail {
    package_id: string;
    external_ref: string | null;
    slug: string | null;
    stock_mode: StockMode | string | null;
    tax_class_id: string | null;
    brand: string | null;
    unit: string | null;
    qty_scale: number | null;
    qty_step: number | null;
    origin_location_id: string | null;
    status: ProductStatus | string;
    published_at: string | null;
    seo_i18n: Record<string, unknown> | null;
    translations: ProductTranslation[];
    option_attribute_ids: string[];
    attribute_value_ids: string[];
    collection_ids: string[];
    variants: VariantDetail[];
    updated_at: string | null;
}

/** One variant of POST/PUT /products. A null or absent field is left unchanged. */
export interface VariantRequest {
    package_session_id?: string;
    name?: string;
    sku?: string;
    /** An empty string clears nothing on the server; it is sent only when typed. */
    barcode?: string;
    stock_policy?: StockPolicy;
    lead_time_days?: number;
    weight_grams?: number;
    position?: number;
    status?: ProductStatus;
    price?: number;
    mrp?: number;
    option_values?: Record<string, string>;
}

/** POST /products and PUT /products/{id}: the whole editor in one call. */
export interface ProductRequest {
    slug?: string;
    stock_mode?: StockMode;
    /** An empty string clears the tax class. */
    tax_class_id?: string;
    brand?: string;
    unit?: string;
    qty_scale?: number;
    qty_step?: number;
    /** An empty string clears the origin. */
    origin_location_id?: string;
    status?: ProductStatus;
    seo_i18n?: Record<string, { title?: string; description?: string }>;
    translations?: Array<{
        locale: string;
        name: string;
        short_description: string | null;
        description_html: string | null;
        content_blocks: ContentBlock[];
    }>;
    option_attribute_ids?: string[];
    attribute_value_ids?: string[];
    collection_ids?: string[];
    variants?: VariantRequest[];
}

export interface CommerceAttributeValue {
    id: string;
    attribute_id: string;
    code: string;
    label_i18n: Record<string, string>;
    swatch_hex: string | null;
    position: number | null;
}

export interface CommerceAttribute {
    id: string;
    code: string;
    name_i18n: Record<string, string>;
    kind: AttributeKind | string;
    is_filterable: boolean;
    position: number | null;
    values: CommerceAttributeValue[];
}

export interface AttributeRequest {
    code?: string;
    name_i18n: Record<string, string>;
    kind: AttributeKind;
    is_filterable: boolean;
}

export interface AttributeValueRequest {
    code?: string;
    label_i18n: Record<string, string>;
    /** An empty string clears the swatch. */
    swatch_hex?: string;
}

export interface CollectionRequest {
    /** An empty string moves the collection to the top level. */
    parent_id?: string;
    kind?: string;
    slug?: string;
    name_i18n?: Record<string, string>;
    /** Replaces the stored descriptions; an empty object clears them. */
    description_i18n?: Record<string, string>;
    /** File id of the collection picture; an empty string removes it. */
    media_id?: string;
    return_window_days?: number;
    position?: number;
    status?: string;
}

/** The photo tags the institute uses, and the one the shop shows first. */
export interface MediaTagList {
    tags: string[];
    lead_tag: string | null;
}

/** One gallery entry of a product. */
export interface ProductMedia {
    id: string;
    package_id: string;
    package_session_id: string | null;
    media_id: string;
    kind: MediaKind | string;
    tag: string | null;
    alt_i18n: Record<string, string>;
    width: number | null;
    height: number | null;
    /**
     * Null until the rendition job has looked at the image. Number keys are
     * widths with public URLs; keys with a leading underscore are the job's
     * state (`media-renditions`).
     */
    renditions: Record<string, unknown> | null;
    position: number | null;
}

export interface ProductMediaRequest {
    package_id?: string;
    /** An empty string unties the entry from a variant. */
    package_session_id?: string;
    media_id?: string;
    kind?: MediaKind;
    /** An empty string clears the tag. */
    tag?: string;
    alt_i18n?: Record<string, string>;
    width?: number;
    height?: number;
}

// ─── Import (CommerceImportController and its DTOs) ──────────────────────────

/** Upload caps of the server (`ImportLimits`); checked here first to save the upload. */
export const IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 5000;

export type ImportSeverity = 'ERROR' | 'WARNING';

/** One finding on one cell: an error leaves the whole product out, a warning does not. */
export interface ImportIssue {
    /** Row in the spreadsheet; the header is row 1. */
    row: number | null;
    /** Template column, or null when the finding is about the product as a whole. */
    column: string | null;
    severity: ImportSeverity;
    /** Stable code, for example DUPLICATE_SKU. */
    code: string | null;
    /** The server's sentence (English). */
    message: string;
    handle: string | null;
}

/** POST /import?mode=validate. Nothing was written. */
export interface ImportValidation {
    file_name: string | null;
    rows_total: number;
    /** Blank rows that were skipped. */
    rows_skipped: number;
    products_total: number;
    products_to_create: number;
    products_to_update: number;
    variants_to_create: number;
    variants_to_update: number;
    /** A commit leaves these products out and writes the others. */
    products_with_errors: number;
    rows_with_errors: number;
    error_count: number;
    warning_count: number;
    /** Errors first, then warnings; capped by the server (see `issues_truncated`). */
    issues: ImportIssue[];
    issues_truncated: boolean;
}

export type ImportJobStatus =
    | 'QUEUED'
    | 'RUNNING'
    | 'COMPLETED'
    | 'COMPLETED_WITH_ERRORS'
    | 'FAILED';

/** POST /import?mode=commit (202) and GET /import/{jobId}. */
export interface ImportJob {
    job_id: string;
    status: ImportJobStatus | string;
    file_name: string | null;
    rows_total: number;
    rows_done: number;
    rows_failed: number;
    products_total: number;
    products_created: number;
    products_updated: number;
    products_failed: number;
    variants_created: number;
    variants_updated: number;
    /** Image addresses kept for the migration tool; the import downloads nothing. */
    image_urls_queued: number;
    error_count: number;
    issues: ImportIssue[];
    issues_truncated: boolean;
    /** Products the job created (capped), for the links on the result. */
    created_package_ids: string[];
    /** True while GET /import/{jobId}/error-rows can still build its file. */
    error_rows_available: boolean;
    failure_message: string | null;
}

/** GET /import/columns: one column of the template, for the column guide. */
export interface ImportColumnGuide {
    column: string;
    /** KEY (every row), PRODUCT (first row of the product) or VARIANT (each row). */
    level: string;
    required: boolean;
    description: string;
    example: string | null;
}
