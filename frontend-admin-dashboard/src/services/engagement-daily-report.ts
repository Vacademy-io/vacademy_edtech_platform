import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { ENGAGEMENT_DAILY_REPORT, ENGAGEMENT_DAILY_REPORT_ITEMS } from '@/constants/urls';

/*
 * Engagement daily report: one engine (or all engines) for one day.
 * Response contract: GET /admin-core-service/v1/engagement/reports/daily
 *   ?instituteId=&engineId=&date=YYYY-MM-DD   (engineId and date optional)
 *
 * The people behind the report's numbers (leads added, demos, status changes, conversions)
 * come from GET /admin-core-service/v1/engagement/reports/daily/items, further down.
 *
 * Every section can fail on its own: its name then appears in `errors` and the
 * rest of the report still renders. A failed or empty section may arrive as
 * null / missing, so the object sections are typed `| null` and the list
 * sections are normalised to [] in `normalizeDailyReport`.
 */

export type DailyReportHealthSeverity = 'critical' | 'warning' | 'info';

export interface DailyReportEngineOption {
    id: string;
    name: string;
    status: string;
    /** The built-in engine that follows up on AI calls (created by the system). */
    system: boolean;
}

export interface DailyReportMoney {
    amount: number;
    currency: string;
    estimated?: boolean;
    /** True when some billable messages had no rate, so the real amount is higher. */
    partial?: boolean;
}

export interface DailyReportSummary {
    leadsAdded: number;
    newLeads: number;
    existingLeads: number;
    decisions: number;
    waited: number;
    failed: number;
    contacted: number;
    emailsSent: number;
    whatsappSent: number;
    inAppSent: number;
    callsPlaced: number;
    delivered: number;
    replies: number;
    callsConnected: number;
    demosBooked: number;
    demosScheduled: number;
    demosDone: number;
    conversions: number;
    statusChanges: number;
    optOuts: number;
    creditsSpent: number;
    whatsappCost: DailyReportMoney | null;
    /** Credits per outcome; null when there were none that day. */
    costPerReply: number | null;
    costPerDemo: number | null;
    costPerConversion: number | null;
    creditBalance: number | null;
    creditRunwayDays: number | null;
}

export interface DailyReportFunnelStage {
    /** CONTACTED | DELIVERED | REPLIED | DEMO_BOOKED | CONVERTED */
    stage: string;
    count: number;
}

export interface DailyReportTrendPoint {
    /** yyyy-MM-dd */
    date: string;
    sent: number;
    replies: number;
    demosBooked: number;
    credits: number;
    statusChanges: number;
}

export interface DailyReportEngineRow {
    engineId: string;
    name: string;
    system: boolean;
    leadsAdded: number;
    sent: number;
    replies: number;
    /** Ratio 0..1. */
    replyRate: number | null;
    demosBooked: number;
    conversions: number;
    credits: number;
    costPerReply: number | null;
}

export interface DailyReportLeadAgent {
    agentId: string;
    name: string;
    discovered: number;
    researched: number;
    delivered: number;
    review: number;
    rejected: number;
    alreadyInCrm: number;
    searches: number;
    pages: number;
    credits: number;
}

export type DailyReportListKind = 'LIST' | 'BATCH' | 'USERS';

export interface DailyReportListRow {
    listId: string;
    name: string;
    kind: DailyReportListKind | string;
    leadsAdded: number;
    newLeads: number;
    existingLeads: number;
    leadAgent: DailyReportLeadAgent | null;
}

export interface DailyReportRuns {
    decisions: number;
    membersEvaluated: number;
    /** Keys: SEND, TASK, NO_OP, REPLY. */
    byKind: Record<string, number>;
    failed: number;
    expired: number;
    topErrors: Array<{ message: string; count: number }>;
}

export type DailyReportChannelKey = 'EMAIL' | 'WHATSAPP' | 'IN_APP' | 'AI_CALL';

export interface DailyReportChannelRow {
    channel: DailyReportChannelKey | string;
    sent: number;
    delivered: number;
    read: number;
    replied: number;
    failed: number;
    /** Ratio 0..1. */
    replyRate: number | null;
    credits: number;
}

export interface DailyReportCalls {
    placed: number;
    notDialled: number;
    connected: number;
    noAnswer: number;
    busy: number;
    failed: number;
    inProgress: number;
    totalMinutes: number;
    avgDurationSec: number;
    credits: number;
}

export interface DailyReportEmail {
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    bounced: number;
    complained: number;
    /** Ratio 0..1. */
    bounceRate: number | null;
    /** False when the sender reports no delivery events (own SMTP, tracking off). */
    tracked: boolean;
    /** False while inbound email is not wired up, so reply counts would be misleading. */
    repliesTracked: boolean;
}

export interface DailyReportWhatsappCategory {
    category: string;
    count: number;
    rate: number | null;
    cost: number | null;
    currency: string;
    estimated: boolean;
}

export interface DailyReportWhatsapp {
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    replied: number;
    /** False for providers that give no delivery receipts. */
    deliveryTracked: boolean;
    billable: number;
    byCategory: DailyReportWhatsappCategory[];
}

export interface DailyReportTemplateRow {
    /** WHATSAPP | EMAIL */
    channel: string;
    /** Template name, or the email subject. */
    name: string;
    sent: number;
    delivered: number;
    read: number;
    replied: number;
    /** Ratio 0..1. */
    replyRate: number | null;
    bounced: number;
    cost: number | null;
    currency: string | null;
}

export interface DailyReportStatusChange {
    /** Null when the person had no status before. */
    from: string | null;
    to: string;
    byEngine: number;
    /** People on the team only. */
    byTeam: number;
    /** Other automations: AI calls, workflows, backfills, cold-email replies. Absent on older responses. */
    byAutomation?: number;
}

export interface DailyReportOutcomes {
    demosBooked: number;
    demosScheduled: number;
    demosDone: number;
    demosNoShow: number;
    demosNotMarked: number;
    conversions: number;
    statusChanges: DailyReportStatusChange[];
}

export interface DailyReportCosts {
    credits: { messages: number; calls: number; leadAgent: number; total: number };
    whatsapp: {
        amount: number;
        currency: string;
        billableMessages: number;
        estimatedMessages: number;
        missingRate: number;
        /** True when some billable messages had no rate, so the real amount is higher. */
        partial?: boolean;
    };
    ai: {
        tokensIn: number;
        tokensOut: number;
        decisionsWithUsage: number;
        /** yyyy-MM-dd; days before this have no token counts. Null until any exist. */
        trackedSince: string | null;
    };
}

/** Super admins only. */
export interface DailyReportRealCost {
    aiUsd: number | null;
    leadAgentUsd: number | null;
    /** Not recorded anywhere yet, so usually null. */
    callsUsd: number | null;
    totalUsd: number | null;
}

export interface DailyReportHealthItem {
    /** EMAIL_BOUNCE_HIGH | EMAIL_COMPLAINTS | WHATSAPP_FAILED_HIGH | OPT_OUTS | CREDITS_LOW | TRACKING_OFF */
    code: string;
    severity: DailyReportHealthSeverity;
    /** Rate (0..1), count or days, depending on the code. */
    value?: number | null;
    /** Only for TRACKING_OFF: EMAIL or WHATSAPP. */
    channel?: string | null;
}

export interface DailyReportNewTemplateCategory {
    /** The category the engine proposed: MARKETING | UTILITY | AUTHENTICATION. */
    category: string;
    count: number;
}

/**
 * WhatsApp templates the engine(s) proposed on the day. Absent on older servers, and listed
 * under `errors` as "newTemplates" when the section failed.
 */
export interface DailyReportNewTemplates {
    created: number;
    byCategory: DailyReportNewTemplateCategory[];
    /** AI_PROPOSED / USER_REVIEW: waiting for the admin. */
    inReview: number;
    /** USER_APPROVED: approved, not yet sent to Meta. */
    approvedByYou: number;
    /** SUBMITTED / META_PENDING. */
    withMeta: number;
    /** META_APPROVED / META_RECATEGORISED. */
    live: number;
    /** META_REJECTED / META_DISABLED. */
    rejected: number;
    /** WITHDRAWN / SUPERSEDED. */
    withdrawn: number;
    /** Proposed as utility, but Meta made it marketing (which costs far more per message). */
    movedToMarketing: number;
}

export interface EngagementDailyReport {
    /** yyyy-MM-dd, in the institute time zone. */
    date: string;
    timezone: string;
    engineId: string | null;
    generatedAt: string;
    /** Picker options. */
    engines: DailyReportEngineOption[];
    summary: DailyReportSummary | null;
    funnel: DailyReportFunnelStage[];
    /** 7 days ending on `date`. */
    trend: DailyReportTrendPoint[];
    /** Only when no engine is selected (null from the server otherwise, [] here). */
    perEngine: DailyReportEngineRow[];
    lists: DailyReportListRow[];
    runs: DailyReportRuns | null;
    channels: DailyReportChannelRow[];
    calls: DailyReportCalls | null;
    email: DailyReportEmail | null;
    whatsapp: DailyReportWhatsapp | null;
    templates: DailyReportTemplateRow[];
    /** Absent on older servers; null here when absent or failed. */
    newTemplates?: DailyReportNewTemplates | null;
    outcomes: DailyReportOutcomes | null;
    costs: DailyReportCosts | null;
    realCost: DailyReportRealCost | null;
    health: DailyReportHealthItem[];
    /** Section name (a field of this object) to a failure message. */
    errors: Record<string, string>;
}

/** HTTP status of a failed report request: 400 bad date, 403 no access, 404 unknown engine. */
export const reportErrorStatus = (error: unknown): number | null =>
    isAxiosError(error) ? error.response?.status ?? null : null;

const list = <T>(value: T[] | null | undefined): T[] => (Array.isArray(value) ? value : []);

const count = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0;

/** A missing figure is 0; a missing block (older server) stays null so the page can tell. */
const normalizeNewTemplates = (
    raw: Partial<DailyReportNewTemplates> | null | undefined
): DailyReportNewTemplates | null =>
    raw
        ? {
              created: count(raw.created),
              byCategory: list(raw.byCategory),
              inReview: count(raw.inReview),
              approvedByYou: count(raw.approvedByYou),
              withMeta: count(raw.withMeta),
              live: count(raw.live),
              rejected: count(raw.rejected),
              withdrawn: count(raw.withdrawn),
              movedToMarketing: count(raw.movedToMarketing),
          }
        : null;

/** Fills the gaps of a partial response so the page never has to guard against undefined lists. */
export const normalizeDailyReport = (
    raw: Partial<EngagementDailyReport> | null | undefined
): EngagementDailyReport => ({
    date: raw?.date ?? '',
    timezone: raw?.timezone ?? '',
    engineId: raw?.engineId ?? null,
    generatedAt: raw?.generatedAt ?? '',
    engines: list(raw?.engines),
    summary: raw?.summary ?? null,
    funnel: list(raw?.funnel),
    trend: list(raw?.trend),
    perEngine: list(raw?.perEngine),
    lists: list(raw?.lists),
    runs: raw?.runs ? { ...raw.runs, topErrors: list(raw.runs.topErrors) } : null,
    channels: list(raw?.channels),
    calls: raw?.calls ?? null,
    email: raw?.email ?? null,
    whatsapp: raw?.whatsapp ? { ...raw.whatsapp, byCategory: list(raw.whatsapp.byCategory) } : null,
    templates: list(raw?.templates),
    newTemplates: normalizeNewTemplates(raw?.newTemplates),
    outcomes: raw?.outcomes
        ? { ...raw.outcomes, statusChanges: list(raw.outcomes.statusChanges) }
        : null,
    costs: raw?.costs ?? null,
    realCost: raw?.realCost ?? null,
    health: list(raw?.health),
    errors: raw?.errors ?? {},
});

/** `engineId` null = all engines; `date` null = today in the institute time zone. */
export const fetchEngagementDailyReport = async (
    instituteId: string,
    engineId: string | null,
    date: string | null
): Promise<EngagementDailyReport> => {
    const res = await authenticatedAxiosInstance.get<Partial<EngagementDailyReport>>(
        ENGAGEMENT_DAILY_REPORT,
        {
            params: {
                instituteId,
                ...(engineId ? { engineId } : {}),
                ...(date ? { date } : {}),
            },
        }
    );
    return normalizeDailyReport(res.data);
};

const REPORT_STALE_MS = 3 * 60 * 1000;

/**
 * One engine (or all) for one day. The server caches each report for 3 minutes, so
 * the same here, with no refetch on focus. A report with failed sections is never
 * treated as fresh, so a retry (or coming back to the page) asks the server again.
 * The previous report stays as placeholder while a new day or engine loads (check
 * `isPlaceholderData`), which keeps the engine picker populated.
 */
export function useEngagementDailyReport(
    instituteId: string,
    engineId: string | null,
    date: string | null,
    enabled = true
) {
    return useQuery({
        queryKey: ['engagement-daily-report', instituteId, engineId, date],
        queryFn: () => fetchEngagementDailyReport(instituteId, engineId, date),
        enabled: enabled && !!instituteId,
        staleTime: (query) =>
            Object.keys(query.state.data?.errors ?? {}).length > 0 ? 0 : REPORT_STALE_MS,
        refetchOnWindowFocus: false,
        // A bad date (400), a missing engine (404) or no access (403) will not fix itself.
        retry: (failureCount, error) => {
            const status = reportErrorStatus(error);
            return failureCount < 1 && !(status !== null && status >= 400 && status < 500);
        },
        placeholderData: keepPreviousData,
    });
}

// ─── The people behind the numbers ──────────────────────────────────────────

/*
 * GET /admin-core-service/v1/engagement/reports/daily/items
 *   ?instituteId=&engineId=&date=YYYY-MM-DD&kind=&filter=&search=&page=&size=
 * Same access rules and day window as the report (not in the future, at most 90 days back;
 * 400 bad date, 403 no access, 404 unknown engine). Counts match the report for the same
 * engine and day. Only the fields that belong to the kind are filled; the rest are null.
 */

export type ReportItemsKind =
    | 'LEADS_ADDED'
    | 'DEMOS_BOOKED'
    | 'DEMOS_SCHEDULED'
    | 'STATUS_CHANGES'
    | 'CONVERSIONS'
    | 'TEMPLATES_CREATED';

export type ReportItemActor = 'ENGINE' | 'TEAM' | 'AUTOMATION';

export interface ReportItemRow {
    leadName?: string | null;
    email?: string | null;
    phone?: string | null;
    /** Either handle can be missing; at least one opens the lead's profile. */
    audienceResponseId?: string | null;
    userId?: string | null;
    engineId?: string | null;
    engineName?: string | null;
    // LEADS_ADDED
    /** A list id, or BATCH / USERS for people who joined through a batch or one by one. */
    listId?: string | null;
    listName?: string | null;
    isNew?: boolean | null;
    leadCreatedAt?: string | null;
    joinedAt?: string | null;
    // DEMOS_BOOKED / DEMOS_SCHEDULED
    bookingId?: string | null;
    bookedAt?: string | null;
    scheduledStart?: string | null;
    bookingStatus?: string | null;
    /** COMPLETED | NO_SHOW | null (not marked). */
    outcome?: string | null;
    hostName?: string | null;
    // STATUS_CHANGES / CONVERSIONS
    fromStatus?: string | null;
    toStatus?: string | null;
    actor?: ReportItemActor | string | null;
    source?: string | null;
    changedByName?: string | null;
    changedAt?: string | null;
    // TEMPLATES_CREATED (the lead fields above are null for this kind)
    templateName?: string | null;
    language?: string | null;
    /** MARKETING | UTILITY | AUTHENTICATION, as the engine proposed it. */
    proposedCategory?: string | null;
    /** The category Meta assigned; null until Meta decides. */
    metaCategory?: string | null;
    /**
     * AI_PROPOSED | USER_REVIEW | USER_APPROVED | SUBMITTED | META_PENDING | META_APPROVED |
     * META_RECATEGORISED | META_REJECTED | META_DISABLED | WITHDRAWN | SUPERSEDED
     */
    templateStatus?: string | null;
    rejectionReason?: string | null;
    createdAt?: string | null;
    submittedAt?: string | null;
}

export interface ReportItemsPage {
    kind: ReportItemsKind;
    date: string;
    timezone: string;
    engineId: string | null;
    total: number;
    page: number;
    size: number;
    rows: ReportItemRow[];
}

export interface ReportItemsParams {
    instituteId: string;
    /** null = all engines. */
    engineId: string | null;
    /** yyyy-MM-dd, in the institute time zone. */
    date: string;
    kind: ReportItemsKind;
    /**
     * new | existing | list:<id> | done | no_show | not_marked | engine | team | automation,
     * and for TEMPLATES_CREATED marketing | utility | authentication | in_review |
     * approved_by_you | with_meta | live | rejected | withdrawn | moved_to_marketing.
     */
    filter?: string;
    /** Lead name, email or phone (not used for TEMPLATES_CREATED). */
    search?: string;
    /** Zero-based. */
    page: number;
    /** At most 500. */
    size: number;
}

/** The server takes at most this many rows in one page. */
export const REPORT_ITEMS_MAX_SIZE = 500;
/** An export stops after this many rows. */
export const REPORT_ITEMS_EXPORT_CAP = 5000;

export const normalizeItemsPage = (
    raw: Partial<ReportItemsPage> | null | undefined,
    params: Pick<ReportItemsParams, 'kind' | 'date' | 'page' | 'size'>
): ReportItemsPage => ({
    kind: raw?.kind ?? params.kind,
    date: raw?.date ?? params.date,
    timezone: raw?.timezone ?? '',
    engineId: raw?.engineId ?? null,
    total: typeof raw?.total === 'number' ? raw.total : 0,
    page: typeof raw?.page === 'number' ? raw.page : params.page,
    size: typeof raw?.size === 'number' ? raw.size : params.size,
    rows: list(raw?.rows),
});

export const fetchEngagementReportItems = async (
    params: ReportItemsParams
): Promise<ReportItemsPage> => {
    const res = await authenticatedAxiosInstance.get<Partial<ReportItemsPage>>(
        ENGAGEMENT_DAILY_REPORT_ITEMS,
        {
            params: {
                instituteId: params.instituteId,
                ...(params.engineId ? { engineId: params.engineId } : {}),
                date: params.date,
                kind: params.kind,
                ...(params.filter ? { filter: params.filter } : {}),
                ...(params.search ? { search: params.search } : {}),
                page: params.page,
                size: params.size,
            },
        }
    );
    return normalizeItemsPage(res.data, params);
};

/**
 * Every row of one list for an export: pages of 500 until `total` is reached, or until
 * `REPORT_ITEMS_EXPORT_CAP` rows. `truncated` says the list had more than was fetched.
 */
export const fetchAllReportItems = async (
    params: Omit<ReportItemsParams, 'page' | 'size'>,
    total: number
): Promise<{ rows: ReportItemRow[]; total: number; truncated: boolean }> => {
    const size = REPORT_ITEMS_MAX_SIZE;
    const wanted = Math.min(total, REPORT_ITEMS_EXPORT_CAP);
    const pages = Math.max(1, Math.ceil(wanted / size));
    const rows: ReportItemRow[] = [];
    let serverTotal = total;
    for (let page = 0; page < pages; page++) {
        const res = await fetchEngagementReportItems({ ...params, page, size });
        serverTotal = res.total;
        rows.push(...res.rows);
        if (res.rows.length < size) break;
    }
    const kept = rows.slice(0, REPORT_ITEMS_EXPORT_CAP);
    return { rows: kept, total: serverTotal, truncated: serverTotal > kept.length };
};

const ITEMS_STALE_MS = 60 * 1000;

/**
 * One page of one list. While another page of the same list loads, the previous page stays on
 * screen; a different list (another tab, day, engine, filter or search) does not, since its rows
 * would not match what was asked for.
 */
export function useEngagementReportItems(params: ReportItemsParams, enabled = true) {
    const { instituteId, engineId, date, kind, filter, search, page, size } = params;
    return useQuery({
        queryKey: [
            'engagement-report-items',
            instituteId,
            engineId,
            date,
            kind,
            filter ?? null,
            search ?? null,
            page,
            size,
        ],
        queryFn: () =>
            fetchEngagementReportItems({
                instituteId,
                engineId,
                date,
                kind,
                filter,
                search,
                page,
                size,
            }),
        enabled: enabled && !!instituteId && !!date,
        staleTime: ITEMS_STALE_MS,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
            const status = reportErrorStatus(error);
            return failureCount < 1 && !(status !== null && status >= 400 && status < 500);
        },
        placeholderData: (previous, previousQuery) =>
            previousQuery &&
            JSON.stringify(previousQuery.queryKey.slice(1, 7)) ===
                JSON.stringify([instituteId, engineId, date, kind, filter ?? null, search ?? null])
                ? previous
                : undefined,
    });
}
