/**
 * AI usage metering v2 — read API for the credits popover (History v2 / Analytics v2).
 *
 * Backed by ai_service `/credits/v2/...` (ai_usage_event rows joined to the
 * credit ledger). Everything here is additive: the v1 fetchers in
 * get-ai-credits.ts are untouched, and the popover only calls these when
 * `usage-config` says `history_v2_enabled` for the current institute.
 *
 * Visibility is enforced server side: admins (and platform staff) get every
 * event of the institute, anyone else only events they performed themselves.
 */
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { AI_SERVICE_BASE_URL } from '@/constants/urls';
import { useQuery, keepPreviousData } from '@tanstack/react-query';

// ---- Types (contract K3) ----

export interface UsageConfig {
    history_v2_enabled: boolean;
    is_admin: boolean;
}

export type RoleClass =
    | 'ADMIN'
    | 'TEACHER'
    | 'STAFF'
    | 'PARENT'
    | 'LEARNER'
    | 'SYSTEM'
    | 'API_KEY'
    | 'PUBLIC'
    | 'UNKNOWN';

export const ROLE_CLASSES: RoleClass[] = [
    'ADMIN',
    'TEACHER',
    'STAFF',
    'PARENT',
    'LEARNER',
    'SYSTEM',
    'API_KEY',
    'PUBLIC',
    'UNKNOWN',
];

export type BillingMode = 'CHARGED' | 'INCLUDED' | 'ALLOWANCE' | 'SPLIT' | 'FREE' | 'BYO_KEY';

export interface UsageUnits {
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    cached_read_tokens?: number | null;
    image_count?: number | null;
    seconds?: number | null;
    minutes?: number | null;
    characters?: number | null;
}

export interface UsageEventItem {
    kind: 'usage';
    id: string;
    occurred_at: string;
    label: string | null;
    use_case: string | null;
    use_case_label: string | null;
    feature_group: string | null;
    actor_user_id: string | null;
    actor_name: string | null;
    actor_role_class: string | null;
    subject_user_id: string | null;
    subject_name: string | null;
    surface: string | null;
    model_id: string | null;
    model_short: string | null;
    units: UsageUnits | null;
    list_credits: number | string | null;
    credits_charged: number | string | null;
    refunded_credits: number | string | null;
    billing_mode: string | null;
    charge_status: string | null;
    batch_id: string | null;
    ledger_tx_id: string | null;
    balance_after: number | string | null;
    context: Record<string, unknown> | null;
    /** Present only for platform staff; tenants never receive vendor cost. */
    real_cost_usd?: number | string | null;
}

export interface UsageLedgerItem {
    kind: 'ledger';
    id: string;
    occurred_at: string;
    transaction_type: string;
    amount: number | string;
    balance_after: number | string | null;
    description: string | null;
}

export type UsageHistoryItem = UsageEventItem | UsageLedgerItem;

export interface UsageEventsResponse {
    items: UsageHistoryItem[];
    page: number;
    page_size: number;
    total: number;
}

export interface UsageEventFilters {
    from?: string;
    to?: string;
    user_id?: string;
    role_class?: string;
    feature_group?: string;
    use_case?: string;
    billing_mode?: string;
    surface?: string;
    min_credits?: number;
}

export type UsageGroupBy = 'use_case' | 'feature_group' | 'role_class' | 'user' | 'day' | 'model';
export type UsageMetric = 'charged' | 'list';

export interface UsageSummaryRow {
    key: string;
    label: string | null;
    credits: number | string;
    events: number;
    share_pct: number | string;
}

export interface UsageSummaryResponse {
    group_by: UsageGroupBy;
    days: number;
    metric: UsageMetric;
    total_credits: number | string;
    total_events: number;
    rows: UsageSummaryRow[];
}

// ---- Helpers ----

const base = (instituteId: string) =>
    `${AI_SERVICE_BASE_URL}/credits/v2/institutes/${encodeURIComponent(instituteId)}`;

/** Drops empty filter values so the query string only carries what is set. */
export function filtersToParams(filters: UsageEventFilters): URLSearchParams {
    const params = new URLSearchParams();
    (Object.keys(filters) as (keyof UsageEventFilters)[]).forEach((k) => {
        const v = filters[k];
        if (v === undefined || v === null || v === '') return;
        params.set(k, String(v));
    });
    return params;
}

/** Decimal columns arrive as numbers or strings depending on the serializer. */
export function toNumber(value: number | string | null | undefined): number {
    if (value === null || value === undefined || value === '') return 0;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
}

// ---- Fetchers ----

export const fetchUsageConfig = async (instituteId: string): Promise<UsageConfig> => {
    const response = await authenticatedAxiosInstance.get<UsageConfig>(
        `${base(instituteId)}/usage-config`
    );
    return response.data;
};

export const fetchUsageEvents = async (
    instituteId: string,
    filters: UsageEventFilters,
    page: number,
    pageSize: number
): Promise<UsageEventsResponse> => {
    const params = filtersToParams(filters);
    params.set('page', String(page));
    params.set('page_size', String(pageSize));
    const response = await authenticatedAxiosInstance.get<UsageEventsResponse>(
        `${base(instituteId)}/usage-events?${params}`
    );
    return response.data;
};

export const fetchUsageSummary = async (
    instituteId: string,
    days: number,
    groupBy: UsageGroupBy,
    metric: UsageMetric
): Promise<UsageSummaryResponse> => {
    const params = new URLSearchParams({
        days: String(days),
        group_by: groupBy,
        metric,
    });
    const response = await authenticatedAxiosInstance.get<UsageSummaryResponse>(
        `${base(instituteId)}/usage-summary?${params}`
    );
    return response.data;
};

/**
 * Admin-only CSV export. Fetched through the authenticated axios instance (the
 * endpoint needs the bearer token) and saved through a temporary anchor.
 */
export async function downloadUsageEventsCsv(
    instituteId: string,
    filters: UsageEventFilters,
    fileName: string
): Promise<void> {
    const params = filtersToParams(filters);
    params.set('format', 'csv');
    const response = await authenticatedAxiosInstance.get<Blob>(
        `${base(instituteId)}/usage-events/export?${params}`,
        { responseType: 'blob' }
    );
    const url = URL.createObjectURL(response.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Give the browser a tick to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- React Query hooks ----

export const usageConfigQueryKey = (instituteId: string | undefined) =>
    ['GET_AI_USAGE_CONFIG', instituteId ?? null] as const;

/**
 * Decides v1 vs v2 for the popover. Any failure (endpoint not deployed yet,
 * 403, network) resolves to "v1" in the caller — the query never retries.
 */
export const useUsageConfigQuery = (instituteId: string | undefined, enabled: boolean) => {
    return useQuery({
        queryKey: usageConfigQueryKey(instituteId),
        queryFn: () => fetchUsageConfig(instituteId as string),
        enabled: enabled && !!instituteId,
        staleTime: 5 * 60 * 1000,
        retry: false,
    });
};

export const useUsageEventsQuery = (
    instituteId: string | undefined,
    filters: UsageEventFilters,
    page: number,
    pageSize: number,
    enabled = true
) => {
    return useQuery({
        queryKey: ['GET_AI_USAGE_EVENTS', instituteId ?? null, filters, page, pageSize],
        queryFn: () => fetchUsageEvents(instituteId as string, filters, page, pageSize),
        enabled: enabled && !!instituteId,
        staleTime: 30000,
        retry: false,
        placeholderData: keepPreviousData,
    });
};

export const useUsageSummaryQuery = (
    instituteId: string | undefined,
    days: number,
    groupBy: UsageGroupBy,
    metric: UsageMetric,
    enabled = true
) => {
    return useQuery({
        queryKey: ['GET_AI_USAGE_SUMMARY', instituteId ?? null, days, groupBy, metric],
        queryFn: () => fetchUsageSummary(instituteId as string, days, groupBy, metric),
        enabled: enabled && !!instituteId,
        staleTime: 60000,
        retry: false,
    });
};
