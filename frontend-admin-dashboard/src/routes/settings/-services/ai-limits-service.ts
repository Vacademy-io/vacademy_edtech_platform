/**
 * AI usage limits — tenant admin API (ai_service `/credits/v2/institutes/{id}/limits`).
 *
 * Contract N5. Every write carries a `reason` (stored in the change log). The
 * server is the boundary: it re-checks the admin role, refuses ENFORCE unless
 * the platform unlocked it (`tenant_may_enforce`), and never lets a tenant edit
 * PLATFORM rows. The normalizers below are deliberately tolerant (numbers as
 * strings, list-or-wrapper responses) so a small server-side shape change
 * degrades a cell rather than the whole tab.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { AI_SERVICE_BASE_URL } from '@/constants/urls';

// ---- Enums ----

export type LimitsMode = 'OFF' | 'SHADOW' | 'ENFORCE';
export type LimitSubjectKind = 'INSTITUTE' | 'ROLE_CLASS' | 'ROLE' | 'USER';
export type LimitScopeKind = 'ALL' | 'GROUP' | 'USE_CASE';
export type LimitPeriod = 'DAY' | 'WEEK' | 'MONTH' | 'PLAN_PERIOD';
export type LimitMetric = 'CREDITS' | 'COUNT' | 'COST_USD';
export type LimitOrigin = 'TENANT' | 'PLATFORM';
export type LimitDecision =
    | 'NONE'
    | 'OK'
    | 'WARN'
    | 'WOULD_BLOCK'
    | 'BLOCK'
    /** effective_limits: a more specific rule replaces this one for the member. */
    | 'OVERRIDDEN'
    /** effective_limits: the row's period is not in use yet (PLAN_PERIOD). */
    | 'NOT_ACTIVE';

export const LIMITS_MODES: LimitsMode[] = ['OFF', 'SHADOW', 'ENFORCE'];
export const SUBJECT_KINDS: LimitSubjectKind[] = ['INSTITUTE', 'ROLE_CLASS', 'ROLE', 'USER'];
export const SCOPE_KINDS: LimitScopeKind[] = ['ALL', 'GROUP', 'USE_CASE'];
/** PLAN_PERIOD exists in the schema but is unused until plans ship. */
export const TENANT_PERIODS: LimitPeriod[] = ['DAY', 'WEEK', 'MONTH'];
/** COST_USD is a platform-only metric (tenants never see vendor dollars). */
export const TENANT_METRICS: LimitMetric[] = ['CREDITS', 'COUNT'];
/** Role classes a tenant can cap (API_KEY / PUBLIC / UNKNOWN are not people). */
export const LIMITABLE_ROLE_CLASSES = ['ADMIN', 'TEACHER', 'STAFF', 'PARENT', 'LEARNER', 'SYSTEM'];
/**
 * Feature groups seeded in ai_use_case_catalog (V586). Offered even when the
 * institute has no usage yet; the server rejects a group the catalog lacks.
 */
export const KNOWN_FEATURE_GROUPS = [
    'tutor',
    'video',
    'calling',
    'content',
    'assessment',
    'analytics',
    'crm',
    'agent',
];

// ---- Types ----

export interface LimitsPolicy {
    mode: LimitsMode;
    tenant_may_enforce: boolean;
    timezone: string | null;
    notify_admins_on_soft: boolean;
    show_numbers_to_learners: boolean;
}

export interface LimitRow {
    id: string;
    subject_kind: LimitSubjectKind;
    subject_value: string | null;
    subject_label: string | null;
    per_member: boolean;
    scope_kind: LimitScopeKind;
    scope_value: string | null;
    scope_label: string | null;
    period: LimitPeriod;
    metric: LimitMetric;
    soft_limit: number | null;
    hard_limit: number | null;
    origin: LimitOrigin;
    locked: boolean;
    is_active: boolean;
    reason: string | null;
    created_by: string | null;
    created_at: string | null;
    updated_at: string | null;
}

export interface LimitsOverview {
    policy: LimitsPolicy;
    rows: LimitRow[];
    platform_rows: LimitRow[];
    enforce_globally_enabled: boolean;
}

/** The editable part of a row (POST body without `reason`). */
export interface LimitDraft {
    subject_kind: LimitSubjectKind;
    subject_value: string | null;
    per_member: boolean;
    scope_kind: LimitScopeKind;
    scope_value: string | null;
    period: LimitPeriod;
    metric: LimitMetric;
    soft_limit: number | null;
    hard_limit: number | null;
}

export interface PolicyUpdate {
    mode: LimitsMode;
    notify_admins_on_soft?: boolean;
    show_numbers_to_learners?: boolean;
    reason: string;
}

export interface PreviewBreakdownRow {
    key: string;
    label: string;
    would_block: number;
    would_warn: number;
}

export interface LimitsPreview {
    days: number;
    /** The replay hit the server's event cap; numbers cover the newest events only. */
    truncated: boolean;
    events_considered: number;
    would_block: number;
    would_warn: number;
    affected_users: number;
    by_use_case: PreviewBreakdownRow[];
    by_user: PreviewBreakdownRow[];
}

export interface EffectiveLimit {
    row: LimitRow | null;
    /** Where the row comes from: PLATFORM | INSTITUTE | ROLE_CLASS | ROLE | USER. */
    scope: string | null;
    scope_label: string | null;
    period: string | null;
    metric: string | null;
    /** null when the row has no single counter (or its period is not active). */
    used: number | null;
    pct: number | null;
    selected: boolean;
    soft: number | null;
    hard: number | null;
    resets_at: string | null;
    decision: LimitDecision;
    why: string | null;
}

export interface LimitUsageMeter {
    key: string;
    label: string;
    period: string;
    credits_used: number;
    count_used: number;
    soft: number | null;
    hard: number | null;
    /** Metric of the binding limit row (null when no row binds the counter). */
    metric: LimitMetric | null;
    pct: number | null;
    resets_at: string | null;
}

// ---- Normalizers ----

type Raw = Record<string, unknown>;

const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);

export function num(v: unknown): number {
    if (v === null || v === undefined || v === '') return 0;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
}

export function numOrNull(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
}

const str = (v: unknown): string | null =>
    v === null || v === undefined || v === '' ? null : String(v);

/** Same rule as the server's normalize_role_name: UPPER, '-' and ' ' → '_'. */
export function normalizeRoleName(raw: string): string {
    return raw.trim().toUpperCase().replace(/[-\s]/g, '_');
}

/** Pulls the list out of a bare array or a `{items|rows|limits|data}` wrapper. */
export function asList(data: unknown, ...keys: string[]): unknown[] {
    if (Array.isArray(data)) return data;
    if (isObj(data)) {
        for (const k of [...keys, 'items', 'rows', 'data']) {
            if (Array.isArray(data[k])) return data[k] as unknown[];
        }
    }
    return [];
}

export function normalizeRow(raw: unknown): LimitRow {
    const r = isObj(raw) ? raw : {};
    return {
        id: String(r.id ?? ''),
        subject_kind: (str(r.subject_kind) ?? 'INSTITUTE') as LimitSubjectKind,
        subject_value: str(r.subject_value),
        subject_label: str(r.subject_label),
        per_member: r.per_member === undefined ? true : !!r.per_member,
        scope_kind: (str(r.scope_kind) ?? 'ALL') as LimitScopeKind,
        scope_value: str(r.scope_value),
        scope_label: str(r.scope_label),
        period: (str(r.period) ?? 'DAY') as LimitPeriod,
        metric: (str(r.metric) ?? 'CREDITS') as LimitMetric,
        soft_limit: numOrNull(r.soft_limit),
        hard_limit: numOrNull(r.hard_limit),
        origin: (str(r.origin) ?? 'TENANT') as LimitOrigin,
        locked: !!r.locked,
        is_active: r.is_active === undefined ? true : !!r.is_active,
        reason: str(r.reason),
        created_by: str(r.created_by),
        created_at: str(r.created_at),
        updated_at: str(r.updated_at),
    };
}

export const DEFAULT_POLICY: LimitsPolicy = {
    mode: 'OFF',
    tenant_may_enforce: false,
    timezone: null,
    notify_admins_on_soft: true,
    show_numbers_to_learners: false,
};

export function normalizeOverview(data: unknown): LimitsOverview {
    const d = isObj(data) ? data : {};
    const p = isObj(d.policy) ? d.policy : {};
    const mode = str(p.mode);
    return {
        policy: {
            mode: mode && (LIMITS_MODES as string[]).includes(mode) ? (mode as LimitsMode) : 'OFF',
            tenant_may_enforce: !!p.tenant_may_enforce,
            timezone: str(p.timezone),
            notify_admins_on_soft:
                p.notify_admins_on_soft === undefined
                    ? DEFAULT_POLICY.notify_admins_on_soft
                    : !!p.notify_admins_on_soft,
            show_numbers_to_learners: !!p.show_numbers_to_learners,
        },
        rows: asList(d.rows)
            .map(normalizeRow)
            .filter((r) => r.is_active),
        platform_rows: asList(d.platform_rows)
            .map(normalizeRow)
            .filter((r) => r.is_active),
        enforce_globally_enabled:
            d.enforce_globally_enabled === undefined ? true : !!d.enforce_globally_enabled,
    };
}

function normalizeBreakdown(raw: unknown, keyFields: string[], labelFields: string[]) {
    const r = isObj(raw) ? raw : {};
    const key = keyFields.map((k) => str(r[k])).find(Boolean) ?? '';
    const label = labelFields.map((k) => str(r[k])).find(Boolean) ?? key;
    return {
        key,
        label,
        would_block: num(r.would_block ?? r.would_block_events ?? r.blocked),
        would_warn: num(r.would_warn ?? r.would_warn_events ?? r.warned),
    };
}

export function normalizePreview(data: unknown): LimitsPreview {
    const d = isObj(data) ? data : {};
    return {
        days: num(d.days) || 30,
        truncated: !!d.truncated,
        events_considered: num(d.events_considered),
        would_block: num(d.would_block),
        would_warn: num(d.would_warn),
        affected_users: num(d.affected_users),
        by_use_case: asList(d.by_use_case).map((r) =>
            normalizeBreakdown(r, ['use_case', 'key'], ['use_case_label', 'label', 'use_case'])
        ),
        // SYSTEM / API-key events have no user id: they group under their role class.
        by_user: asList(d.by_user).map((r) =>
            normalizeBreakdown(
                r,
                ['user_id', 'actor_user_id', 'key', 'role_class'],
                ['name', 'user_name', 'actor_name', 'label', 'email', 'user_id', 'role_class']
            )
        ),
    };
}

export function normalizeEffective(data: unknown): EffectiveLimit[] {
    return asList(data, 'limits', 'effective').map((raw) => {
        const r = isObj(raw) ? raw : {};
        const decision = str(r.decision) ?? 'NONE';
        return {
            row: isObj(r.row) ? normalizeRow(r.row) : null,
            scope: str(r.scope),
            scope_label: str(r.scope_label),
            period: str(r.period),
            metric: str(r.metric),
            used: numOrNull(r.used),
            pct: numOrNull(r.pct),
            selected: r.selected === undefined ? true : !!r.selected,
            soft: numOrNull(r.soft),
            hard: numOrNull(r.hard),
            resets_at: str(r.resets_at),
            decision: decision as LimitDecision,
            why: str(r.why),
        };
    });
}

export function normalizeUsage(data: unknown): LimitUsageMeter[] {
    return asList(data, 'counters', 'usage', 'meters').map((raw) => {
        const r = isObj(raw) ? raw : {};
        const key = str(r.key) ?? '';
        return {
            key,
            label: str(r.label) ?? key,
            period: str(r.period) ?? '',
            credits_used: num(r.credits_used),
            count_used: num(r.count_used),
            soft: numOrNull(r.soft),
            hard: numOrNull(r.hard),
            metric: (str(r.metric) as LimitMetric | null) ?? null,
            pct: numOrNull(r.pct),
            resets_at: str(r.resets_at),
        };
    });
}

/** Strips the fields a scope/subject kind does not take, so the server sees a clean body. */
export function cleanDraft(d: LimitDraft): LimitDraft {
    const subjectNeedsValue = d.subject_kind !== 'INSTITUTE';
    const scopeNeedsValue = d.scope_kind !== 'ALL';
    const isRole = d.subject_kind === 'ROLE' || d.subject_kind === 'ROLE_CLASS';
    return {
        ...d,
        subject_value: subjectNeedsValue ? d.subject_value : null,
        // per_member only means something for role rows; the server stores TRUE for the rest.
        per_member: isRole ? d.per_member : true,
        scope_value: scopeNeedsValue ? d.scope_value : null,
    };
}

// ---- Fetchers ----

const limitsBase = (instituteId: string) =>
    `${AI_SERVICE_BASE_URL}/credits/v2/institutes/${encodeURIComponent(instituteId)}/limits`;

export async function fetchLimits(instituteId: string): Promise<LimitsOverview> {
    const res = await authenticatedAxiosInstance.get(limitsBase(instituteId));
    return normalizeOverview(res.data);
}

export async function updateLimitsPolicy(
    instituteId: string,
    body: PolicyUpdate
): Promise<unknown> {
    const res = await authenticatedAxiosInstance.put(`${limitsBase(instituteId)}/policy`, body);
    return res.data;
}

export async function createLimitRow(
    instituteId: string,
    draft: LimitDraft,
    reason: string
): Promise<LimitRow> {
    const res = await authenticatedAxiosInstance.post(`${limitsBase(instituteId)}/rows`, {
        ...cleanDraft(draft),
        reason,
    });
    return normalizeRow(res.data);
}

/**
 * PATCH changes the soft / hard limit only (the server ignores anything else):
 * who / what / period / metric are fixed once a row exists — remove it and add
 * a new one to change those.
 */
export async function updateLimitRow(
    instituteId: string,
    rowId: string,
    limits: Pick<LimitDraft, 'soft_limit' | 'hard_limit'>,
    reason: string
): Promise<LimitRow> {
    const res = await authenticatedAxiosInstance.patch(
        `${limitsBase(instituteId)}/rows/${encodeURIComponent(rowId)}`,
        { soft_limit: limits.soft_limit, hard_limit: limits.hard_limit, reason }
    );
    return normalizeRow(res.data);
}

export async function deleteLimitRow(
    instituteId: string,
    rowId: string,
    reason: string
): Promise<void> {
    await authenticatedAxiosInstance.delete(
        `${limitsBase(instituteId)}/rows/${encodeURIComponent(rowId)}`,
        { params: { reason } }
    );
}

/**
 * Replays the last 30 days against the proposed rows. When editing, the row id
 * goes along so the server can treat the proposal as a replacement.
 */
export async function previewLimits(
    instituteId: string,
    rows: Array<LimitDraft & { id?: string }>
): Promise<LimitsPreview> {
    const res = await authenticatedAxiosInstance.post(`${limitsBase(instituteId)}/preview`, {
        rows: rows.map((r) => ({ ...cleanDraft(r), ...(r.id ? { id: r.id } : {}) })),
    });
    return normalizePreview(res.data);
}

export async function fetchEffectiveLimits(
    instituteId: string,
    userId: string
): Promise<EffectiveLimit[]> {
    const res = await authenticatedAxiosInstance.get(`${limitsBase(instituteId)}/effective`, {
        params: { user_id: userId },
    });
    return normalizeEffective(res.data);
}

export async function fetchLimitsUsage(
    instituteId: string,
    period: LimitPeriod
): Promise<LimitUsageMeter[]> {
    const res = await authenticatedAxiosInstance.get(`${limitsBase(instituteId)}/usage`, {
        params: { period },
    });
    return normalizeUsage(res.data);
}

// ---- React Query hooks ----

export const limitsQueryKey = (instituteId: string | undefined) =>
    ['AI_USAGE_LIMITS', instituteId ?? null] as const;

export const useLimitsQuery = (instituteId: string | undefined, enabled = true) =>
    useQuery({
        queryKey: limitsQueryKey(instituteId),
        queryFn: () => fetchLimits(instituteId as string),
        enabled: enabled && !!instituteId,
        staleTime: 30000,
        retry: false,
    });

export const useLimitsUsageQuery = (
    instituteId: string | undefined,
    period: LimitPeriod,
    enabled = true
) =>
    useQuery({
        queryKey: ['AI_USAGE_LIMITS_USAGE', instituteId ?? null, period],
        queryFn: () => fetchLimitsUsage(instituteId as string, period),
        enabled: enabled && !!instituteId,
        staleTime: 30000,
        retry: false,
    });

export const useEffectiveLimitsQuery = (instituteId: string | undefined, userId: string | null) =>
    useQuery({
        queryKey: ['AI_USAGE_LIMITS_EFFECTIVE', instituteId ?? null, userId],
        queryFn: () => fetchEffectiveLimits(instituteId as string, userId as string),
        enabled: !!instituteId && !!userId,
        staleTime: 15000,
        retry: false,
    });

/** Invalidates everything the tab shows after a write. */
export function useInvalidateLimits(instituteId: string | undefined) {
    const qc = useQueryClient();
    return () => {
        qc.invalidateQueries({ queryKey: limitsQueryKey(instituteId) });
        qc.invalidateQueries({ queryKey: ['AI_USAGE_LIMITS_USAGE', instituteId ?? null] });
        qc.invalidateQueries({ queryKey: ['AI_USAGE_LIMITS_EFFECTIVE', instituteId ?? null] });
    };
}

/** The server's error text (FastAPI `detail`, a string or a validation list), else null. */
export function apiErrorMessage(err: unknown): string | null {
    const data = (err as { response?: { data?: unknown } })?.response?.data;
    if (!isObj(data)) return null;
    const detail = data.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
        const msgs = detail
            .map((d) => (isObj(d) ? str(d.msg) : str(d)))
            .filter(Boolean) as string[];
        return msgs.length ? msgs.join('; ') : null;
    }
    if (isObj(detail) && typeof detail.message === 'string') return detail.message;
    if (typeof data.message === 'string') return data.message;
    return null;
}
