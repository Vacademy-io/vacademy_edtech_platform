import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    COMMERCE_MAX_PAGE_SIZE,
    asList,
    asRecord,
    instituteParams,
    num,
    str,
} from './commerce-api';
import {
    COMMERCE_ATTRIBUTES,
    COMMERCE_ATTRIBUTE_BY_ID,
    COMMERCE_ATTRIBUTE_VALUES,
    COMMERCE_ATTRIBUTE_VALUE_BY_ID,
    COMMERCE_COLLECTIONS,
    COMMERCE_COLLECTION_BY_ID,
    COMMERCE_COLLECTION_PRODUCTS,
    COMMERCE_COLLECTION_TREE,
    COMMERCE_IMPORT,
    COMMERCE_IMPORT_COLUMNS,
    COMMERCE_IMPORT_ERROR_ROWS,
    COMMERCE_IMPORT_JOB,
    COMMERCE_IMPORT_JOB_ERROR_ROWS,
    COMMERCE_IMPORT_TEMPLATE,
    COMMERCE_MEDIA,
    COMMERCE_MEDIA_BY_ID,
    COMMERCE_MEDIA_ORDER,
    COMMERCE_MEDIA_TAGS,
    COMMERCE_MEDIA_RENDITION_RETRY,
    COMMERCE_PRODUCTS,
    COMMERCE_PRODUCTS_EXPORT,
    COMMERCE_PRODUCT_BY_ID,
    COMMERCE_PRODUCT_STATUS,
} from './commerce-urls';
import type { CommerceCollection, ProductStatus } from './commerce-types';
import type {
    AttributeRequest,
    AttributeValueRequest,
    CollectionRequest,
    CommerceAttribute,
    CommerceAttributeValue,
    ContentBlock,
    ImportColumnGuide,
    ImportIssue,
    ImportJob,
    ImportValidation,
    ProductDetail,
    MediaTagList,
    ProductMedia,
    ProductMediaRequest,
    ProductRequest,
    ProductTranslation,
    VariantDetail,
} from './catalogue-types';

/**
 * Catalogue admin services (products, variants, attributes, collections,
 * media, import and export): one function per endpoint, no React. Every
 * response is normalised here, so a screen never reads a raw body.
 */

const stringMap = (value: unknown): Record<string, string> => {
    const r = asRecord(value);
    if (!r) return {};
    return Object.entries(r).reduce<Record<string, string>>((out, [key, entry]) => {
        if (typeof entry === 'string' && entry.length > 0) out[key] = entry;
        return out;
    }, {});
};

const stringList = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v) : [];

// ─── Products ────────────────────────────────────────────────────────────────

function normalizeBlocks(value: unknown): ContentBlock[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry): ContentBlock | null => {
            const r = asRecord(entry);
            const code = str(r?.code);
            return r && code ? { code, html: typeof r.html === 'string' ? r.html : '' } : null;
        })
        .filter((block): block is ContentBlock => block !== null);
}

function normalizeTranslation(value: unknown): ProductTranslation | null {
    const r = asRecord(value);
    const locale = str(r?.locale);
    if (!r || !locale) return null;
    return {
        locale,
        name: str(r.name) ?? '',
        short_description: str(r.short_description),
        description_html: str(r.description_html),
        content_blocks: normalizeBlocks(r.content_blocks),
    };
}

function normalizeVariant(value: unknown): VariantDetail | null {
    const r = asRecord(value);
    const id = str(r?.package_session_id);
    if (!r || !id) return null;
    return {
        package_session_id: id,
        name: str(r.name),
        sku: str(r.sku),
        barcode: str(r.barcode),
        label_code: str(r.label_code),
        stock_policy: str(r.stock_policy),
        lead_time_days: num(r.lead_time_days),
        weight_grams: num(r.weight_grams),
        position: num(r.position),
        status: str(r.status),
        external_ref: str(r.external_ref),
        price: num(r.price),
        mrp: num(r.mrp),
        currency: str(r.currency),
        option_values: stringMap(r.option_values),
    };
}

export function normalizeProduct(data: unknown): ProductDetail | null {
    const r = asRecord(data);
    const id = str(r?.package_id);
    if (!r || !id) return null;
    const list = <T>(value: unknown, map: (entry: unknown) => T | null): T[] =>
        (Array.isArray(value) ? value : []).map(map).filter((entry): entry is T => entry !== null);
    return {
        package_id: id,
        external_ref: str(r.external_ref),
        slug: str(r.slug),
        stock_mode: str(r.stock_mode),
        tax_class_id: str(r.tax_class_id),
        brand: str(r.brand),
        unit: str(r.unit),
        qty_scale: num(r.qty_scale),
        qty_step: num(r.qty_step),
        origin_location_id: str(r.origin_location_id),
        status: str(r.status) ?? 'DRAFT',
        published_at: str(r.published_at),
        seo_i18n: asRecord(r.seo_i18n),
        translations: list(r.translations, normalizeTranslation),
        option_attribute_ids: stringList(r.option_attribute_ids),
        attribute_value_ids: stringList(r.attribute_value_ids),
        collection_ids: stringList(r.collection_ids),
        variants: list(r.variants, normalizeVariant).sort(
            (a, b) => (a.position ?? 0) - (b.position ?? 0)
        ),
        updated_at: str(r.updated_at),
    };
}

const requireProduct = (data: unknown): ProductDetail => {
    const product = normalizeProduct(data);
    if (!product) throw new Error('The server answered without a product');
    return product;
};

export async function fetchProduct(packageId: string): Promise<ProductDetail> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_PRODUCT_BY_ID(packageId), {
        params: instituteParams(),
    });
    return requireProduct(res.data);
}

/** Creates (no id) or updates the product with its variants, in one transaction. */
export async function saveProduct(
    body: ProductRequest,
    packageId?: string
): Promise<ProductDetail> {
    const res = packageId
        ? await authenticatedAxiosInstance.put<unknown>(COMMERCE_PRODUCT_BY_ID(packageId), body, {
              params: instituteParams(),
          })
        : await authenticatedAxiosInstance.post<unknown>(COMMERCE_PRODUCTS, body, {
              params: instituteParams(),
          });
    return requireProduct(res.data);
}

/** Publish (ACTIVE), back to draft (DRAFT) or archive (ARCHIVED). */
export async function changeProductStatus(
    packageId: string,
    status: ProductStatus
): Promise<ProductDetail> {
    const res = await authenticatedAxiosInstance.post<unknown>(
        COMMERCE_PRODUCT_STATUS(packageId),
        { status },
        { params: instituteParams() }
    );
    return requireProduct(res.data);
}

// ─── Attributes ──────────────────────────────────────────────────────────────

function normalizeAttributeValue(value: unknown): CommerceAttributeValue | null {
    const r = asRecord(value);
    const id = str(r?.id);
    if (!r || !id) return null;
    return {
        id,
        attribute_id: str(r.attribute_id) ?? '',
        code: str(r.code) ?? '',
        label_i18n: stringMap(r.label_i18n),
        swatch_hex: str(r.swatch_hex),
        position: num(r.position),
    };
}

export function normalizeAttribute(value: unknown): CommerceAttribute | null {
    const r = asRecord(value);
    const id = str(r?.id);
    if (!r || !id) return null;
    const byPosition = (a: { position: number | null }, b: { position: number | null }) =>
        (a.position ?? 0) - (b.position ?? 0);
    return {
        id,
        code: str(r.code) ?? '',
        name_i18n: stringMap(r.name_i18n),
        kind: str(r.kind) ?? 'TEXT',
        is_filterable: r.is_filterable === true,
        position: num(r.position),
        values: (Array.isArray(r.values) ? r.values : [])
            .map(normalizeAttributeValue)
            .filter((entry): entry is CommerceAttributeValue => entry !== null)
            .sort(byPosition),
    };
}

/** The first 100 attributes with their values; the server caps the page. */
export async function fetchAttributes(): Promise<CommerceAttribute[]> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_ATTRIBUTES, {
        params: { ...instituteParams(), page: 0, size: COMMERCE_MAX_PAGE_SIZE },
    });
    return asList<unknown>(res.data)
        .map(normalizeAttribute)
        .filter((attribute): attribute is CommerceAttribute => attribute !== null)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

export async function saveAttribute(body: AttributeRequest, id?: string): Promise<void> {
    if (id) {
        await authenticatedAxiosInstance.put(COMMERCE_ATTRIBUTE_BY_ID(id), body, {
            params: instituteParams(),
        });
        return;
    }
    await authenticatedAxiosInstance.post(COMMERCE_ATTRIBUTES, body, { params: instituteParams() });
}

export async function deleteAttribute(id: string): Promise<void> {
    await authenticatedAxiosInstance.delete(COMMERCE_ATTRIBUTE_BY_ID(id), {
        params: instituteParams(),
    });
}

export async function saveAttributeValue(
    attributeId: string,
    body: AttributeValueRequest,
    valueId?: string
): Promise<void> {
    if (valueId) {
        await authenticatedAxiosInstance.put(
            COMMERCE_ATTRIBUTE_VALUE_BY_ID(attributeId, valueId),
            body,
            { params: instituteParams() }
        );
        return;
    }
    await authenticatedAxiosInstance.post(COMMERCE_ATTRIBUTE_VALUES(attributeId), body, {
        params: instituteParams(),
    });
}

export async function deleteAttributeValue(attributeId: string, valueId: string): Promise<void> {
    await authenticatedAxiosInstance.delete(COMMERCE_ATTRIBUTE_VALUE_BY_ID(attributeId, valueId), {
        params: instituteParams(),
    });
}

// ─── Collections ─────────────────────────────────────────────────────────────

export function normalizeCollection(value: unknown): CommerceCollection | null {
    const r = asRecord(value);
    const id = str(r?.id);
    if (!r || !id) return null;
    return {
        id,
        parent_id: str(r.parent_id),
        kind: str(r.kind) ?? 'COLLECTION',
        slug: str(r.slug),
        name_i18n: stringMap(r.name_i18n),
        description_i18n: stringMap(r.description_i18n),
        media_id: str(r.media_id),
        return_window_days: num(r.return_window_days),
        position: num(r.position),
        status: str(r.status),
        external_ref: str(r.external_ref),
        children: (Array.isArray(r.children) ? r.children : [])
            .map(normalizeCollection)
            .filter((child): child is CommerceCollection => child !== null),
    };
}

export async function fetchCollectionTree(): Promise<CommerceCollection[]> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_COLLECTION_TREE, {
        params: instituteParams(),
    });
    return asList<unknown>(res.data)
        .map(normalizeCollection)
        .filter((collection): collection is CommerceCollection => collection !== null);
}

export async function saveCollection(body: CollectionRequest, id?: string): Promise<void> {
    if (id) {
        await authenticatedAxiosInstance.put(COMMERCE_COLLECTION_BY_ID(id), body, {
            params: instituteParams(),
        });
        return;
    }
    await authenticatedAxiosInstance.post(COMMERCE_COLLECTIONS, body, {
        params: instituteParams(),
    });
}

/** Product (package) ids of a collection, in display order. */
export async function fetchCollectionProductIds(collectionId: string): Promise<string[]> {
    const res = await authenticatedAxiosInstance.get<unknown>(
        COMMERCE_COLLECTION_PRODUCTS(collectionId),
        { params: instituteParams() }
    );
    return stringList(res.data);
}

/** Replaces the stored set of the collection. */
export async function saveCollectionProductIds(
    collectionId: string,
    packageIds: string[]
): Promise<string[]> {
    const res = await authenticatedAxiosInstance.put<unknown>(
        COMMERCE_COLLECTION_PRODUCTS(collectionId),
        { package_ids: packageIds },
        { params: instituteParams() }
    );
    return stringList(res.data);
}

// ─── Media ───────────────────────────────────────────────────────────────────

export function normalizeMedia(value: unknown): ProductMedia | null {
    const r = asRecord(value);
    const id = str(r?.id);
    const mediaId = str(r?.media_id);
    if (!r || !id || !mediaId) return null;
    return {
        id,
        package_id: str(r.package_id) ?? '',
        package_session_id: str(r.package_session_id),
        media_id: mediaId,
        kind: str(r.kind) ?? 'IMAGE',
        tag: str(r.tag),
        alt_i18n: stringMap(r.alt_i18n),
        width: num(r.width),
        height: num(r.height),
        renditions: asRecord(r.renditions),
        position: num(r.position),
    };
}

const mediaList = (data: unknown): ProductMedia[] =>
    asList<unknown>(data)
        .map(normalizeMedia)
        .filter((media): media is ProductMedia => media !== null)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

/**
 * The tags a photo can carry in this institute (its own list with the lead tag
 * in it, or the built-in three). Anything that is not a short text is dropped.
 */
export function normalizeMediaTags(value: unknown): MediaTagList {
    const r = asRecord(value);
    const tags = asList<unknown>(r?.tags)
        .map((tag) => str(tag))
        .filter((tag): tag is string => !!tag && tag.length <= 32);
    return { tags: [...new Set(tags)], lead_tag: str(r?.lead_tag) };
}

export async function fetchMediaTags(): Promise<MediaTagList> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_MEDIA_TAGS, {
        params: instituteParams(),
    });
    return normalizeMediaTags(res.data);
}

export async function fetchProductMedia(packageId: string): Promise<ProductMedia[]> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_MEDIA, {
        params: { ...instituteParams(), packageId, page: 0, size: COMMERCE_MAX_PAGE_SIZE },
    });
    return mediaList(res.data);
}

/** Attaches a file that the media service already holds. */
export async function attachProductMedia(body: ProductMediaRequest): Promise<void> {
    await authenticatedAxiosInstance.post(COMMERCE_MEDIA, body, { params: instituteParams() });
}

export async function updateProductMedia(id: string, body: ProductMediaRequest): Promise<void> {
    await authenticatedAxiosInstance.put(COMMERCE_MEDIA_BY_ID(id), body, {
        params: instituteParams(),
    });
}

export async function removeProductMedia(id: string): Promise<void> {
    await authenticatedAxiosInstance.delete(COMMERCE_MEDIA_BY_ID(id), {
        params: instituteParams(),
    });
}

/** `mediaRowIds` must name every gallery entry of the product exactly once. */
export async function reorderProductMedia(
    packageId: string,
    mediaRowIds: string[]
): Promise<ProductMedia[]> {
    const res = await authenticatedAxiosInstance.put<unknown>(
        COMMERCE_MEDIA_ORDER,
        { package_id: packageId, media_row_ids: mediaRowIds },
        { params: instituteParams() }
    );
    return mediaList(res.data);
}

/** Asks the rendition job to try a failed image again. */
export async function retryMediaRendition(mediaRowId: string): Promise<void> {
    await authenticatedAxiosInstance.post(COMMERCE_MEDIA_RENDITION_RETRY(mediaRowId), null, {
        params: instituteParams(),
    });
}

// ─── Import and export ───────────────────────────────────────────────────────

const count = (value: unknown): number => num(value) ?? 0;

function normalizeIssue(value: unknown): ImportIssue | null {
    const r = asRecord(value);
    const message = str(r?.message);
    if (!r || !message) return null;
    return {
        row: num(r.row),
        column: str(r.column),
        severity: str(r.severity) === 'WARNING' ? 'WARNING' : 'ERROR',
        code: str(r.code),
        message,
        handle: str(r.handle),
    };
}

const issueList = (value: unknown): ImportIssue[] =>
    (Array.isArray(value) ? value : [])
        .map(normalizeIssue)
        .filter((issue): issue is ImportIssue => issue !== null);

export function normalizeImportValidation(data: unknown): ImportValidation {
    const r = asRecord(data) ?? {};
    const issues = issueList(r.issues);
    return {
        file_name: str(r.file_name),
        rows_total: count(r.rows_total),
        rows_skipped: count(r.rows_skipped),
        products_total: count(r.products_total),
        products_to_create: count(r.products_to_create),
        products_to_update: count(r.products_to_update),
        variants_to_create: count(r.variants_to_create),
        variants_to_update: count(r.variants_to_update),
        products_with_errors: count(r.products_with_errors),
        rows_with_errors: count(r.rows_with_errors),
        // The list is capped; the counts are exact, so they win when present.
        error_count:
            num(r.error_count) ?? issues.filter((issue) => issue.severity === 'ERROR').length,
        warning_count:
            num(r.warning_count) ?? issues.filter((issue) => issue.severity === 'WARNING').length,
        issues,
        issues_truncated: r.issues_truncated === true,
    };
}

export function normalizeImportJob(data: unknown): ImportJob | null {
    const r = asRecord(data);
    const jobId = str(r?.job_id);
    if (!r || !jobId) return null;
    const issues = issueList(r.issues);
    return {
        job_id: jobId,
        status: str(r.status) ?? 'QUEUED',
        file_name: str(r.file_name),
        rows_total: count(r.rows_total),
        rows_done: count(r.rows_done),
        rows_failed: count(r.rows_failed),
        products_total: count(r.products_total),
        products_created: count(r.products_created),
        products_updated: count(r.products_updated),
        products_failed: count(r.products_failed),
        variants_created: count(r.variants_created),
        variants_updated: count(r.variants_updated),
        image_urls_queued: count(r.image_urls_queued),
        error_count: num(r.error_count) ?? issues.length,
        issues,
        issues_truncated: r.issues_truncated === true,
        created_package_ids: stringList(r.created_package_ids),
        error_rows_available: r.error_rows_available === true,
        failure_message: str(r.failure_message),
    };
}

const requireJob = (data: unknown): ImportJob => {
    const job = normalizeImportJob(data);
    if (!job) throw new Error('The server answered without an import job');
    return job;
};

/** QUEUED and RUNNING are the two states a job is still polled in. */
export const importJobIsRunning = (job: Pick<ImportJob, 'status'> | null | undefined): boolean =>
    !!job && (job.status === 'QUEUED' || job.status === 'RUNNING');

/** Rows the job has dealt with, as a whole percentage of the file. */
export function importJobPercent(
    job: Pick<ImportJob, 'rows_total' | 'rows_done' | 'rows_failed'>
): number {
    if (job.rows_total <= 0) return 0;
    const done = Math.round(((job.rows_done + job.rows_failed) / job.rows_total) * 100);
    return Math.max(0, Math.min(100, done));
}

const fileForm = (file: File): FormData => {
    const form = new FormData();
    form.append('file', file);
    return form;
};

const MULTIPART = { 'Content-Type': 'multipart/form-data' };

/** Dry run: every row is checked and nothing is written. */
export async function validateImport(file: File): Promise<ImportValidation> {
    const res = await authenticatedAxiosInstance.post<unknown>(COMMERCE_IMPORT, fileForm(file), {
        params: { ...instituteParams(), mode: 'validate' },
        headers: MULTIPART,
    });
    return normalizeImportValidation(res.data);
}

/** Stores the file and starts the background job. */
export async function startImport(file: File): Promise<ImportJob> {
    const res = await authenticatedAxiosInstance.post<unknown>(COMMERCE_IMPORT, fileForm(file), {
        params: { ...instituteParams(), mode: 'commit' },
        headers: MULTIPART,
    });
    return requireJob(res.data);
}

export async function fetchImportJob(jobId: string): Promise<ImportJob> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_IMPORT_JOB(jobId), {
        params: instituteParams(),
    });
    return requireJob(res.data);
}

export async function fetchImportColumns(): Promise<ImportColumnGuide[]> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_IMPORT_COLUMNS, {
        params: instituteParams(),
    });
    return asList<unknown>(res.data)
        .map((entry): ImportColumnGuide | null => {
            const r = asRecord(entry);
            const column = str(r?.column);
            if (!r || !column) return null;
            return {
                column,
                level: str(r.level) ?? '',
                required: r.required === true,
                description: str(r.description) ?? '',
                example: str(r.example),
            };
        })
        .filter((column): column is ImportColumnGuide => column !== null);
}

export interface DownloadedFile {
    blob: Blob;
    /** From Content-Disposition when the server names the file. */
    filename: string | null;
}

/** The file name of a Content-Disposition header, plain or RFC 5987 encoded. */
export function filenameOf(disposition: unknown): string | null {
    if (typeof disposition !== 'string') return null;
    const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition);
    if (encoded?.[1]) {
        try {
            return decodeURIComponent(encoded[1].trim());
        } catch {
            return encoded[1].trim();
        }
    }
    const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition);
    return plain?.[1]?.trim() || null;
}

const asDownload = (res: { data: Blob; headers?: Record<string, unknown> }): DownloadedFile => ({
    blob: res.data,
    filename: filenameOf(res.headers?.['content-disposition']),
});

/** The fixed import template; the server owns the column list. */
export async function downloadImportTemplate(format: 'xlsx' | 'csv'): Promise<DownloadedFile> {
    const res = await authenticatedAxiosInstance.get<Blob>(COMMERCE_IMPORT_TEMPLATE, {
        params: { ...instituteParams(), format },
        responseType: 'blob',
    });
    return asDownload(res);
}

/** The rows of this file a commit would leave out, to fix and upload again. */
export async function downloadValidationErrorRows(file: File): Promise<DownloadedFile> {
    const res = await authenticatedAxiosInstance.post<Blob>(
        COMMERCE_IMPORT_ERROR_ROWS,
        fileForm(file),
        { params: instituteParams(), headers: MULTIPART, responseType: 'blob' }
    );
    return asDownload(res);
}

/** The rows a finished job left out. */
export async function downloadJobErrorRows(jobId: string): Promise<DownloadedFile> {
    const res = await authenticatedAxiosInstance.get<Blob>(COMMERCE_IMPORT_JOB_ERROR_ROWS(jobId), {
        params: instituteParams(),
        responseType: 'blob',
    });
    return asDownload(res);
}

/** Most product ids one "export selected" may name (`ImportLimits`). */
export const EXPORT_MAX_IDS = 500;

export interface ProductExportFilters {
    status?: string;
    /** Only these products ("export selected"). */
    packageIds?: string[];
}

/**
 * GET /products/export: the catalogue in the import template, as CSV. The
 * server filters by status or by product ids only; it has no search or
 * collection filter.
 */
export async function downloadProductExport(
    filters: ProductExportFilters = {}
): Promise<DownloadedFile> {
    const res = await authenticatedAxiosInstance.get<Blob>(COMMERCE_PRODUCTS_EXPORT, {
        params: {
            ...instituteParams(),
            status: filters.status || undefined,
            packageIds: filters.packageIds?.length ? filters.packageIds.join(',') : undefined,
        },
        responseType: 'blob',
    });
    return asDownload(res);
}

/**
 * A failed download answers its JSON error as a Blob (the request asked for
 * one). This reads the server's sentence out of it; null when there is none.
 */
export async function blobErrorMessage(error: unknown): Promise<string | null> {
    const data = asRecord(asRecord(error)?.response)?.data;
    if (!(data instanceof Blob)) return null;
    try {
        const body = asRecord(JSON.parse(await data.text()));
        return str(body?.message) ?? str(body?.ex);
    } catch {
        return null;
    }
}
