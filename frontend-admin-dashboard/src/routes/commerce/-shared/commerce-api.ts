import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getInstituteId } from '@/constants/helper';
import { GET_INSTITUTE_USERS } from '@/constants/urls';
import { COMMERCE_ROLE_NAMES, isCommerceRoleName } from '@/lib/commerce/commerce-access';
import {
    COMMERCE_COLLECTIONS,
    COMMERCE_LOCATION_BY_ID,
    COMMERCE_LOCATIONS,
    COMMERCE_PRODUCTS,
    COMMERCE_SETTINGS,
    COMMERCE_STAFF_LOCATIONS,
    COMMERCE_STAFF_PIN,
    COMMERCE_TAX_CLASS_BY_ID,
    COMMERCE_TAX_CLASSES,
} from './commerce-urls';
import type {
    CommerceCollection,
    CommerceLocation,
    CommerceLocationRequest,
    CommercePage,
    CommerceStaffMember,
    CommerceTaxSettings,
    CommerceTaxSettingsRequest,
    ProductSummary,
    StaffLocations,
    StaffLocationsRequest,
    StaffPinStatus,
    TaxClass,
    TaxClassRequest,
    TaxRateRule,
} from './commerce-types';

/**
 * Commerce admin services: one function per endpoint, no React.
 *
 * Every call carries the current institute. The server is the authority: a 403
 * starts with a code (`FEATURE_DISABLED: …`, `ROLE_NOT_ALLOWED: …`,
 * `LOCATION_NOT_ALLOWED: …`, `PIN_INVALID: …`, `PIN_LOCKED: …`) and a 409 carries
 * the sentence to show.
 */

/** Largest page any commerce list asks for; the server caps it too. */
export const COMMERCE_MAX_PAGE_SIZE = 100;

export const instituteParams = () => ({ instituteId: getInstituteId() });

export const asRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;

export const str = (value: unknown): string | null =>
    typeof value === 'string' && value.length > 0 ? value : null;

export const num = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
        return Number(value);
    }
    return null;
};

/** A list endpoint may answer a bare array or a page; both become an array. */
export function asList<T>(data: unknown): T[] {
    if (Array.isArray(data)) return data as T[];
    const content = asRecord(data)?.content;
    return Array.isArray(content) ? (content as T[]) : [];
}

/** Spring's page (camelCase) or an already snake_case page, normalised. */
export function asPage<T>(data: unknown, fallbackSize: number): CommercePage<T> {
    const r = asRecord(data) ?? {};
    const content = asList<T>(data);
    return {
        content,
        page_no: num(r.number) ?? num(r.page_no) ?? 0,
        page_size: num(r.size) ?? num(r.page_size) ?? fallbackSize,
        total_pages: num(r.totalPages) ?? num(r.total_pages) ?? 1,
        total_elements: num(r.totalElements) ?? num(r.total_elements) ?? content.length,
        last: typeof r.last === 'boolean' ? r.last : true,
    };
}

// ─── Staff ───────────────────────────────────────────────────────────────────

export async function fetchStaffLocations(userId: string): Promise<StaffLocations> {
    const res = await authenticatedAxiosInstance.get<StaffLocations>(COMMERCE_STAFF_LOCATIONS, {
        params: { ...instituteParams(), userId },
    });
    return {
        user_id: res.data?.user_id ?? userId,
        location_ids: Array.isArray(res.data?.location_ids) ? res.data.location_ids : [],
    };
}

export async function saveStaffLocations(body: StaffLocationsRequest): Promise<StaffLocations> {
    const res = await authenticatedAxiosInstance.put<StaffLocations>(
        COMMERCE_STAFF_LOCATIONS,
        body,
        { params: instituteParams() }
    );
    return {
        user_id: res.data?.user_id ?? body.user_id,
        location_ids: Array.isArray(res.data?.location_ids) ? res.data.location_ids : [],
    };
}

export async function fetchMyPinStatus(): Promise<StaffPinStatus> {
    const res = await authenticatedAxiosInstance.get<StaffPinStatus>(COMMERCE_STAFF_PIN, {
        params: instituteParams(),
    });
    return { has_pin: res.data?.has_pin === true };
}

/** Sets the caller's OWN PIN; nobody can set one for someone else. */
export async function saveMyPin(pin: string): Promise<StaffPinStatus> {
    const res = await authenticatedAxiosInstance.put<StaffPinStatus>(
        COMMERCE_STAFF_PIN,
        { pin },
        { params: instituteParams() }
    );
    return { has_pin: res.data?.has_pin === true };
}

/**
 * People who hold a commerce role, plus institute admins (who can do everything
 * a store manager can). Read from the Teams users endpoint in auth_service: a
 * commerce `/staff` list is not built. Roles are granted
 * in Teams by an institute ADMIN, never from the shop screens.
 */
export async function fetchCommerceStaff(): Promise<CommerceStaffMember[]> {
    const res = await authenticatedAxiosInstance.post<unknown>(
        GET_INSTITUTE_USERS,
        { roles: ['ADMIN', ...COMMERCE_ROLE_NAMES], status: ['ACTIVE'] },
        { params: { ...instituteParams(), pageNumber: 0, pageSize: COMMERCE_MAX_PAGE_SIZE } }
    );
    return asList<Record<string, unknown>>(res.data)
        .map((user): CommerceStaffMember | null => {
            const id = str(user.id);
            if (!id) return null;
            const roles = (Array.isArray(user.roles) ? user.roles : [])
                .map(
                    (role) =>
                        str(asRecord(role)?.role_name) ?? (typeof role === 'string' ? role : '')
                )
                .map((role) => role.toUpperCase())
                .filter(Boolean);
            return {
                user_id: id,
                full_name: str(user.full_name) ?? str(user.username) ?? '',
                email: str(user.email),
                is_admin: roles.includes('ADMIN'),
                commerce_roles: COMMERCE_ROLE_NAMES.filter((role) => roles.includes(role)),
                has_other_roles: roles.some(
                    (role) => role !== 'ADMIN' && !isCommerceRoleName(role)
                ),
            };
        })
        .filter((member): member is CommerceStaffMember => member !== null);
}

// ─── Catalogue ───────────────────────────────────────────────────────────────

export interface ProductListFilters {
    status?: string;
    q?: string;
    collectionId?: string;
    /**
     * `taxClassMissing` is read by the server. `stockState` is sent, but GET
     * /products does not read it yet and its rows carry no `stock_state`; the
     * list screen says so instead of pretending to filter
     * (`serverFilterSupport` in `product-list`).
     */
    stockState?: 'OUT_OF_STOCK' | 'LOW_STOCK' | 'IN_STOCK';
    taxClassMissing?: boolean;
    page?: number;
    size?: number;
}

export async function fetchProducts(
    filters: ProductListFilters = {}
): Promise<CommercePage<ProductSummary>> {
    const size = Math.min(filters.size ?? 20, COMMERCE_MAX_PAGE_SIZE);
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_PRODUCTS, {
        params: {
            ...instituteParams(),
            status: filters.status || undefined,
            q: filters.q || undefined,
            collectionId: filters.collectionId || undefined,
            // stockState is not read by the server yet (see ProductListFilters); harmless until then.
            stockState: filters.stockState || undefined,
            taxClassMissing: filters.taxClassMissing ? true : undefined,
            page: filters.page ?? 0,
            size,
        },
    });
    return asPage<ProductSummary>(res.data, size);
}

/** Pages read at most by `fetchAllProducts`: 50 × 100 = 5,000 products. */
export const ALL_PRODUCTS_MAX_PAGES = 50;

/**
 * Every product matching the filters, page after page (100 a page), up to
 * `maxPages`. For a list that must name all its members, such as the products
 * of a collection, where the first page alone left the rest unnamed.
 */
export async function fetchAllProducts(
    filters: Omit<ProductListFilters, 'page' | 'size'> = {},
    maxPages = ALL_PRODUCTS_MAX_PAGES
): Promise<ProductSummary[]> {
    const out: ProductSummary[] = [];
    for (let page = 0; page < maxPages; page++) {
        const result = await fetchProducts({ ...filters, page, size: COMMERCE_MAX_PAGE_SIZE });
        out.push(...result.content);
        const lastPage = result.last || page + 1 >= result.total_pages || result.content.length === 0;
        if (lastPage) break;
    }
    return out;
}

export async function fetchCollections(
    page = 0,
    size = 50
): Promise<CommercePage<CommerceCollection>> {
    const capped = Math.min(size, COMMERCE_MAX_PAGE_SIZE);
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_COLLECTIONS, {
        params: { ...instituteParams(), page, size: capped },
    });
    return asPage<CommerceCollection>(res.data, capped);
}

// ─── Tax settings ────────────────────────────────────────────────────────────

const EMPTY_TAX_SETTINGS: CommerceTaxSettings = {
    tax_mode: null,
    slab_basis: null,
    slab_compare: null,
    round_total_to: null,
    seller_gstin: null,
    seller_state_code: null,
    seller_legal_name: null,
    seller_address: null,
};

export function normalizeTaxSettings(data: unknown): CommerceTaxSettings {
    const r = asRecord(data);
    if (!r) return EMPTY_TAX_SETTINGS;
    return {
        tax_mode: str(r.tax_mode) as CommerceTaxSettings['tax_mode'],
        slab_basis: str(r.slab_basis) as CommerceTaxSettings['slab_basis'],
        slab_compare: str(r.slab_compare) as CommerceTaxSettings['slab_compare'],
        round_total_to: str(r.round_total_to) as CommerceTaxSettings['round_total_to'],
        seller_gstin: str(r.seller_gstin),
        seller_state_code: str(r.seller_state_code),
        seller_legal_name: str(r.seller_legal_name),
        seller_address: str(r.seller_address),
    };
}

/** No row yet (an empty body) means "tax is not set up": every field null. */
export async function fetchTaxSettings(): Promise<CommerceTaxSettings> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_SETTINGS, {
        params: instituteParams(),
    });
    return normalizeTaxSettings(res.data);
}

export async function saveTaxSettings(
    body: CommerceTaxSettingsRequest
): Promise<CommerceTaxSettings> {
    const res = await authenticatedAxiosInstance.put<unknown>(COMMERCE_SETTINGS, body, {
        params: instituteParams(),
    });
    return normalizeTaxSettings(res.data ?? body);
}

// ─── Tax classes ─────────────────────────────────────────────────────────────

function normalizeRule(data: unknown): TaxRateRule | null {
    const r = asRecord(data);
    if (!r) return null;
    const rate = num(r.rate_percent);
    const from = str(r.effective_from);
    if (rate === null || !from) return null;
    return {
        id: str(r.id) ?? undefined,
        min_unit_price: num(r.min_unit_price) ?? 0,
        max_unit_price: num(r.max_unit_price),
        rate_percent: rate,
        cess_percent: num(r.cess_percent),
        effective_from: from,
        effective_to: str(r.effective_to),
    };
}

export function normalizeTaxClass(data: unknown): TaxClass | null {
    const r = asRecord(data);
    const id = str(r?.id);
    if (!r || !id) return null;
    const rules = Array.isArray(r.rules) ? r.rules : [];
    return {
        id,
        code: str(r.code) ?? '',
        name: str(r.name) ?? '',
        hsn_code: str(r.hsn_code),
        unit: str(r.unit),
        status: str(r.status),
        rules: rules.map(normalizeRule).filter((rule): rule is TaxRateRule => rule !== null),
    };
}

export async function fetchTaxClasses(): Promise<TaxClass[]> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_TAX_CLASSES, {
        params: { ...instituteParams(), page: 0, size: COMMERCE_MAX_PAGE_SIZE },
    });
    return asList<unknown>(res.data)
        .map(normalizeTaxClass)
        .filter((taxClass): taxClass is TaxClass => taxClass !== null);
}

export async function saveTaxClass(body: TaxClassRequest, id?: string): Promise<void> {
    if (id) {
        await authenticatedAxiosInstance.put(COMMERCE_TAX_CLASS_BY_ID(id), body, {
            params: instituteParams(),
        });
        return;
    }
    await authenticatedAxiosInstance.post(COMMERCE_TAX_CLASSES, body, {
        params: instituteParams(),
    });
}

// ─── Locations ───────────────────────────────────────────────────────────────

const flag = (r: Record<string, unknown>, ...keys: string[]): boolean =>
    keys.some((key) => r[key] === true);

/** Accepts `is_store` or the bare entity name `store`. */
export function normalizeLocation(data: unknown): CommerceLocation | null {
    const r = asRecord(data);
    const id = str(r?.id);
    if (!r || !id) return null;
    return {
        id,
        code: str(r.code) ?? '',
        name: str(r.name) ?? '',
        address_line1: str(r.address_line1),
        address_line2: str(r.address_line2),
        city: str(r.city),
        pincode: str(r.pincode),
        state_code: str(r.state_code),
        gstin: str(r.gstin),
        is_store: flag(r, 'is_store', 'store'),
        is_warehouse: flag(r, 'is_warehouse', 'warehouse'),
        is_source: flag(r, 'is_source', 'source'),
        is_temporary: flag(r, 'is_temporary', 'temporary'),
        starts_on: str(r.starts_on),
        ends_on: str(r.ends_on),
        sells_online: flag(r, 'sells_online'),
        is_pos_enabled: flag(r, 'is_pos_enabled', 'pos_enabled'),
        status: str(r.status),
    };
}

export async function fetchLocations(): Promise<CommerceLocation[]> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_LOCATIONS, {
        params: { ...instituteParams(), page: 0, size: COMMERCE_MAX_PAGE_SIZE },
    });
    return asList<unknown>(res.data)
        .map(normalizeLocation)
        .filter((location): location is CommerceLocation => location !== null);
}

export async function saveLocation(body: CommerceLocationRequest, id?: string): Promise<void> {
    if (id) {
        await authenticatedAxiosInstance.put(COMMERCE_LOCATION_BY_ID(id), body, {
            params: instituteParams(),
        });
        return;
    }
    await authenticatedAxiosInstance.post(COMMERCE_LOCATIONS, body, {
        params: instituteParams(),
    });
}
