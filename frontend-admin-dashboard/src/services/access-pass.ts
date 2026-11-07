import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

/**
 * Access Pass admin API. One pass = one purchasable product unlocking a set of
 * courses; checkout runs on its system-managed invite. Backend:
 * admin_core_service features/access_pass, docs/accesspass/ACCESS_PASS_IMPLEMENTATION.md.
 */
const ACCESS_PASS_BASE = `${BASE_URL}/admin-core-service/v1/access-pass`;

export type AccessPassStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED' | 'DELETED';
export type ItemRemovalPolicy = 'KEEP_FOR_EXISTING' | 'REVOKE';
/** B2C: sold to learners. B2B: assigned to sub-orgs, which get its courses. */
export type AccessPassAudience = 'B2C' | 'B2B';
/** ALL_COURSES follows the institute catalogue automatically. */
export type AccessPassCourseScope = 'SELECTED' | 'ALL_COURSES';

export interface AccessPassItem {
    package_session_id: string;
    package_id?: string;
    package_name?: string;
    level_name?: string;
    session_name?: string;
    thumbnail_file_id?: string;
    course_preview_image_media_id?: string;
    display_order?: number;
    added_at?: string;
}

export interface AccessPassPrice {
    payment_option_id?: string;
    payment_option_name?: string;
    type?: string;
    min_price?: number;
    max_price?: number;
    currency?: string;
    min_validity_in_days?: number;
    plan_count?: number;
}

export interface AccessPass {
    id: string;
    institute_id: string;
    name: string;
    slug: string;
    short_description?: string;
    description?: string;
    cover_image_url?: string;
    tags?: string[];
    status: AccessPassStatus;
    audience_type?: AccessPassAudience;
    course_scope?: AccessPassCourseScope;
    payment_option_id?: string;
    on_item_removed?: ItemRemovalPolicy;
    display_order?: number;
    settings_json?: string;
    enroll_invite_id?: string;
    invite_code?: string;
    short_url?: string;
    course_count?: number;
    current_holder_count?: number;
    sub_org_count?: number;
    price?: AccessPassPrice;
    items?: AccessPassItem[];
    needs_sync?: boolean;
    last_synced_at?: string;
    created_at?: string;
    updated_at?: string;
}

export interface AccessPassRequest {
    name?: string;
    slug?: string;
    short_description?: string;
    description?: string;
    cover_image_url?: string;
    tags?: string[];
    payment_option_id?: string;
    on_item_removed?: ItemRemovalPolicy;
    display_order?: number;
    /** Create only. */
    audience_type?: AccessPassAudience;
    course_scope?: AccessPassCourseScope;
    /** Create only, SELECTED scope only. */
    package_session_ids?: string[];
}

export interface AccessPassHolder {
    user_plan_id: string;
    user_id: string;
    full_name?: string;
    email?: string;
    mobile_number?: string;
    plan_status: string;
    start_date?: string;
    end_date?: string;
    auto_renewal_enabled?: boolean;
    purchased_at?: string;
    granted_courses?: number;
    covered_courses?: number;
}

export interface Page<T> {
    content: T[];
    totalElements: number;
    totalPages: number;
    number: number;
    size: number;
}

export interface AccessPassSyncReport {
    access_pass_id: string;
    plans_processed: number;
    plans_failed: number;
    courses_granted: number;
    courses_covered: number;
    ledger_rows_recorded: number;
    courses_revoked: number;
    items_added: number;
    items_removed: number;
    sub_orgs_synced: number;
    sub_orgs_failed: number;
    sub_org_courses_linked: number;
    complete: boolean;
    skipped_locked: boolean;
}

const instituteParams = () => {
    const instituteId = getCurrentInstituteId();
    if (!instituteId) throw new Error('Institute ID not found');
    return { instituteId };
};

export const listAccessPasses = async (): Promise<AccessPass[]> =>
    (await authenticatedAxiosInstance.get<AccessPass[]>(`${ACCESS_PASS_BASE}/list`, { params: instituteParams() }))
        .data;

export const getAccessPass = async (id: string): Promise<AccessPass> =>
    (await authenticatedAxiosInstance.get<AccessPass>(`${ACCESS_PASS_BASE}/${id}`, { params: instituteParams() }))
        .data;

export const createAccessPass = async (body: AccessPassRequest): Promise<AccessPass> =>
    (await authenticatedAxiosInstance.post<AccessPass>(ACCESS_PASS_BASE, body, { params: instituteParams() })).data;

export const updateAccessPass = async (id: string, body: AccessPassRequest): Promise<AccessPass> =>
    (
        await authenticatedAxiosInstance.put<AccessPass>(`${ACCESS_PASS_BASE}/${id}`, body, {
            params: instituteParams(),
        })
    ).data;

export const updateAccessPassStatus = async (id: string, status: AccessPassStatus): Promise<AccessPass> =>
    (
        await authenticatedAxiosInstance.put<AccessPass>(`${ACCESS_PASS_BASE}/${id}/status`, null, {
            params: { ...instituteParams(), status },
        })
    ).data;

export const addAccessPassItems = async (id: string, packageSessionIds: string[]): Promise<AccessPass> =>
    (
        await authenticatedAxiosInstance.post<AccessPass>(
            `${ACCESS_PASS_BASE}/${id}/items`,
            { package_session_ids: packageSessionIds },
            { params: instituteParams() }
        )
    ).data;

export const removeAccessPassItem = async (id: string, packageSessionId: string): Promise<AccessPass> =>
    (
        await authenticatedAxiosInstance.delete<AccessPass>(
            `${ACCESS_PASS_BASE}/${id}/items/${encodeURIComponent(packageSessionId)}`,
            { params: instituteParams() }
        )
    ).data;

export const getAccessPassHolders = async (
    id: string,
    pageNo: number,
    pageSize: number
): Promise<Page<AccessPassHolder>> =>
    (
        await authenticatedAxiosInstance.get<Page<AccessPassHolder>>(`${ACCESS_PASS_BASE}/${id}/holders`, {
            params: { ...instituteParams(), pageNo, pageSize },
        })
    ).data;

export const syncAccessPass = async (id: string): Promise<AccessPassSyncReport> =>
    (
        await authenticatedAxiosInstance.post<AccessPassSyncReport>(`${ACCESS_PASS_BASE}/${id}/sync`, null, {
            params: instituteParams(),
        })
    ).data;

export interface AccessPassSubOrgLink {
    sub_org_id: string;
    sub_org_name?: string;
    status: string;
    assigned_at?: string;
    last_synced_at?: string;
}

export const getAccessPassSubOrgs = async (id: string): Promise<AccessPassSubOrgLink[]> =>
    (
        await authenticatedAxiosInstance.get<AccessPassSubOrgLink[]>(`${ACCESS_PASS_BASE}/${id}/sub-orgs`, {
            params: instituteParams(),
        })
    ).data;

export const assignAccessPassSubOrg = async (id: string, subOrgId: string): Promise<AccessPassSubOrgLink[]> =>
    (
        await authenticatedAxiosInstance.post<AccessPassSubOrgLink[]>(
            `${ACCESS_PASS_BASE}/${id}/sub-orgs/${encodeURIComponent(subOrgId)}`,
            null,
            { params: instituteParams() }
        )
    ).data;

export const unassignAccessPassSubOrg = async (id: string, subOrgId: string): Promise<AccessPassSubOrgLink[]> =>
    (
        await authenticatedAxiosInstance.delete<AccessPassSubOrgLink[]>(
            `${ACCESS_PASS_BASE}/${id}/sub-orgs/${encodeURIComponent(subOrgId)}`,
            { params: instituteParams() }
        )
    ).data;

export const ACCESS_PASS_QUERY_KEYS = {
    list: ['access-passes'] as const,
    detail: (id: string) => ['access-pass', id] as const,
    holders: (id: string, pageNo: number) => ['access-pass-holders', id, pageNo] as const,
    subOrgs: (id: string) => ['access-pass-sub-orgs', id] as const,
};

/** "₹999 – ₹1,499" style label, or the option type when it has no plans. */
export const formatPassPrice = (price?: AccessPassPrice): string => {
    if (!price) return '—';
    if (price.type === 'FREE') return 'Free';
    if (price.min_price == null) return price.payment_option_name ?? price.type ?? '—';
    const fmt = (v: number) => {
        if (!price.currency) return String(v);
        try {
            return new Intl.NumberFormat(undefined, { style: 'currency', currency: price.currency }).format(v);
        } catch {
            return `${price.currency} ${v}`;
        }
    };
    return price.max_price != null && price.max_price !== price.min_price
        ? `${fmt(price.min_price)} – ${fmt(price.max_price)}`
        : fmt(price.min_price);
};
