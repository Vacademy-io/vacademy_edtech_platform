import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { ENGAGEMENT_DIAGNOSIS } from '@/constants/urls';
import { reportErrorStatus } from '@/services/engagement-daily-report';

/*
 * Engagement diagnosis: where the lead-to-demo chain is breaking and what to change.
 * Contract: GET /admin-core-service/v1/engagement/reports/diagnosis
 *   ?instituteId=&engineId=&view=DAILY|WEEKLY&to=YYYY-MM-DD&fresh=
 * (engineId optional: no engine = all engines; no `to` = today in the institute time zone.)
 * The period is `to..to` for DAILY and `to-6..to` for WEEKLY. Same guard, day window and 400 / 403
 * behaviour as /reports/daily. Rules decide what is wrong (no AI), so every field is a count or a
 * rate (a fraction 0..1). Spec: docs/engagement/ENGAGEMENT_DIAGNOSIS.md.
 *
 * A code, stage, status or verdict from a newer backend must not crash the page, so those fields
 * keep the contract's values in their types but are plain strings at runtime; the page words an
 * unknown one safely.
 */

export type DiagnosisView = 'DAILY' | 'WEEKLY';

/** In the order the page lists them. */
export const DIAGNOSIS_STAGES = ['LEADS', 'CALLING', 'WHATSAPP', 'EMAIL', 'ENGINE'] as const;
export type DiagnosisStageKey = (typeof DIAGNOSIS_STAGES)[number];

export type DiagnosisSeverity = 'critical' | 'warning';

/**
 * PROBLEM: a problem fired. UNAVAILABLE: its data failed to load, never OK. NO_ACTIVITY: nothing
 * happened in that channel. NOT_ENOUGH_DATA: activity below every rule's minimum. OK: enough
 * activity and nothing fired.
 */
export type DiagnosisStageStatus =
    | 'PROBLEM'
    | 'UNAVAILABLE'
    | 'NO_ACTIVITY'
    | 'NOT_ENOUGH_DATA'
    | 'OK';

/** BEST and WORST only among rows with enough sends, and only when at least two rows have enough. */
export type DiagnosisVerdict = 'BEST' | 'WORST' | 'OK' | 'NOT_ENOUGH_DATA';

/** Where a problem leads: OUTCOMES (a channel, optionally one outcome) or ITEMS (a list `kind`). */
export interface DiagnosisLink {
    target: 'OUTCOMES' | 'ITEMS' | string;
    channel: string | null;
    outcome: string | null;
    kind: string | null;
}

export interface DiagnosisBreakdownEntry {
    key: string;
    count: number;
}

export interface DiagnosisProblem {
    /** A code from the rule catalogue, or one a newer backend added. */
    code: string;
    stage: DiagnosisStageKey | string;
    severity: DiagnosisSeverity;
    /** People or messages this touches; the ranking key. */
    affected: number;
    /** Per code: see the catalogue. Rates are fractions 0..1. */
    numbers: Record<string, number>;
    breakdown: DiagnosisBreakdownEntry[];
    /** Per code: agent names, a template, a subject, an objection. */
    names: string[];
    link: DiagnosisLink | null;
}

export interface DiagnosisStageRow {
    stage: DiagnosisStageKey | string;
    status: DiagnosisStageStatus | string;
}

/** What the report cannot see, so a 0 is not read as a real 0. */
export interface DiagnosisDataGap {
    /** EMAIL_REPLIES_NOT_TRACKED | EMAIL_TRACKING_OFF | WHATSAPP_TRACKING_OFF | CALL_ANALYSIS_EMPTY */
    code: string;
    /** For EMAIL_REPLIES_NOT_TRACKED: the sender addresses. */
    names: string[];
}

// ─── weekly ────────────────────────────────────────────────────────────────

/** The least a row needs before it is compared; null when the server did not say. */
export interface DiagnosisMinimums {
    leadsPerSource: number | null;
    callsPerHour: number | null;
    sendsPerRow: number | null;
}

export interface DiagnosisLeadSource {
    /** lead_candidate.source, or OTHER for leads the Lead Agent did not deliver. */
    source: string;
    leads: number;
    /** Null when that read failed, as for every nullable count below: unknown, not 0. */
    contacted: number | null;
    /** Replied to a message or picked up a call. */
    responded: number | null;
    demosBooked: number | null;
    contactRate: number | null;
    responseRate: number | null;
    enough: boolean;
}

export interface DiagnosisCallHour {
    /** 0..23, in the institute time zone. */
    hour: number;
    placed: number;
    connected: number;
    connectRate: number | null;
    enough: boolean;
}

export interface DiagnosisCallLengths {
    connected: number;
    under20s: number;
    s20to60: number;
    over60: number;
}

export interface DiagnosisCallInsights {
    analysed: number;
    /** POSITIVE | NEUTRAL | NEGATIVE, as stored per call. */
    sentiment: Record<string, number>;
    outcomes: Array<{ status: string; count: number }>;
    highLikelihood: number;
    topObjections: Array<{ text: string; count: number }>;
}

export interface DiagnosisWhatsappFailure {
    /** NOT_ON_WHATSAPP | MARKETING_LIMIT | USER_STOPPED_MARKETING | OUTSIDE_24H_WINDOW | TEMPLATE_PROBLEM | PAYMENT_ISSUE | RATE_LIMITED | REJECTED_AT_SEND | OTHER */
    reason: string;
    /** Meta's raw error code; null for REJECTED_AT_SEND. */
    code: string | null;
    count: number;
}

export interface DiagnosisWhatsappTemplate {
    name: string;
    sent: number;
    delivered: number;
    read: number;
    replied: number;
    replyRate: number | null;
    verdict: DiagnosisVerdict | string;
}

export interface DiagnosisEmailSubject {
    name: string;
    sent: number;
    delivered: number;
    clicked: number;
    bounced: number;
    /** Null when no send of this row could report a reply (the sender's replies can't reach us). */
    replied: number | null;
    clickRate: number | null;
    replyRate: number | null;
    verdict: DiagnosisVerdict | string;
}

export interface DiagnosisPromptChange {
    engineId: string;
    engineName: string;
    version: number;
    createdAt: string;
    source: string;
    /** What the admin typed, cut to 300 characters. */
    change: string;
    sends: number;
    replies: number | null;
    replyRate: number | null;
    demosBooked: number | null;
    enough: boolean;
}

export interface DiagnosisEngineChecks {
    doubleContact: number | null;
    sentAfterReply: number | null;
    stuckMembers: number | null;
}

export interface DiagnosisWeekly {
    minimums: DiagnosisMinimums;
    leadSources: DiagnosisLeadSource[];
    callHours: DiagnosisCallHour[];
    callLengths: DiagnosisCallLengths | null;
    callInsights: DiagnosisCallInsights | null;
    whatsappFailures: DiagnosisWhatsappFailure[];
    whatsappTemplates: DiagnosisWhatsappTemplate[];
    emailSubjects: DiagnosisEmailSubject[];
    /** Versions with sends in the period, newest first. */
    promptChanges: DiagnosisPromptChange[];
    engineChecks: DiagnosisEngineChecks | null;
}

export interface EngagementDiagnosis {
    view: DiagnosisView;
    /** yyyy-MM-dd in the institute time zone, both days included. */
    from: string;
    to: string;
    days: number;
    timezone: string;
    engineId: string | null;
    generatedAt: string;
    /** Ranked: critical first, then most affected, then stage order. At most 5 daily, 10 weekly. */
    problems: DiagnosisProblem[];
    /** How many problems the cap cut. */
    moreProblems: number;
    /** One row per stage, in stage order. */
    stages: DiagnosisStageRow[];
    dataGaps: DiagnosisDataGap[];
    /** Filled for WEEKLY only. */
    weekly: DiagnosisWeekly | null;
    /** Section name to "unavailable". */
    errors: Record<string, string>;
}

// ─── normalising ───────────────────────────────────────────────────────────

const list = <T>(value: T[] | null | undefined): T[] => (Array.isArray(value) ? value : []);

const isNum = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

const count = (value: unknown): number => (isNum(value) ? value : 0);

/** A number the server could not read stays null, never a false 0 or 0%. */
const rate = (value: unknown): number | null => (isNum(value) ? value : null);
const countOrNull = rate;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

const numbersOf = (value: unknown): Record<string, number> =>
    value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).filter(([, v]) => isNum(v)))
        : {};

const normalizeLink = (raw: Partial<DiagnosisLink> | null | undefined): DiagnosisLink | null =>
    raw && typeof raw === 'object' && typeof raw.target === 'string'
        ? {
              target: raw.target,
              channel: raw.channel ?? null,
              outcome: raw.outcome ?? null,
              kind: raw.kind ?? null,
          }
        : null;

const normalizeProblem = (raw: Partial<DiagnosisProblem>): DiagnosisProblem => ({
    code: text(raw.code),
    stage: text(raw.stage),
    // Anything the page does not know is shown as a warning, never as the most urgent thing.
    severity: raw.severity === 'critical' ? 'critical' : 'warning',
    affected: count(raw.affected),
    numbers: numbersOf(raw.numbers),
    breakdown: list(raw.breakdown)
        .filter((b) => b && typeof b.key === 'string')
        .map((b) => ({ key: b.key, count: count(b.count) })),
    names: strings(raw.names),
    link: normalizeLink(raw.link),
});

const normalizeWeekly = (
    raw: Partial<DiagnosisWeekly> | null | undefined
): DiagnosisWeekly | null => {
    if (!raw || typeof raw !== 'object') return null;
    const minimums: Partial<DiagnosisMinimums> = raw.minimums ?? {};
    const lengths = raw.callLengths;
    const insights = raw.callInsights;
    const checks = raw.engineChecks;
    return {
        minimums: {
            leadsPerSource: isNum(minimums.leadsPerSource) ? minimums.leadsPerSource : null,
            callsPerHour: isNum(minimums.callsPerHour) ? minimums.callsPerHour : null,
            sendsPerRow: isNum(minimums.sendsPerRow) ? minimums.sendsPerRow : null,
        },
        leadSources: list(raw.leadSources).map((r) => ({
            source: text(r.source),
            leads: count(r.leads),
            contacted: countOrNull(r.contacted),
            responded: countOrNull(r.responded),
            demosBooked: countOrNull(r.demosBooked),
            contactRate: rate(r.contactRate),
            responseRate: rate(r.responseRate),
            enough: r.enough === true,
        })),
        callHours: list(raw.callHours).map((r) => ({
            hour: count(r.hour),
            placed: count(r.placed),
            connected: count(r.connected),
            connectRate: rate(r.connectRate),
            enough: r.enough === true,
        })),
        callLengths: lengths
            ? {
                  connected: count(lengths.connected),
                  under20s: count(lengths.under20s),
                  s20to60: count(lengths.s20to60),
                  over60: count(lengths.over60),
              }
            : null,
        callInsights: insights
            ? {
                  analysed: count(insights.analysed),
                  sentiment: numbersOf(insights.sentiment),
                  outcomes: list(insights.outcomes).map((o) => ({
                      status: text(o.status),
                      count: count(o.count),
                  })),
                  highLikelihood: count(insights.highLikelihood),
                  topObjections: list(insights.topObjections).map((o) => ({
                      text: text(o.text),
                      count: count(o.count),
                  })),
              }
            : null,
        whatsappFailures: list(raw.whatsappFailures).map((r) => ({
            reason: text(r.reason),
            code: r.code ?? null,
            count: count(r.count),
        })),
        whatsappTemplates: list(raw.whatsappTemplates).map((r) => ({
            name: text(r.name),
            sent: count(r.sent),
            delivered: count(r.delivered),
            read: count(r.read),
            replied: count(r.replied),
            replyRate: rate(r.replyRate),
            verdict: text(r.verdict),
        })),
        emailSubjects: list(raw.emailSubjects).map((r) => ({
            name: text(r.name),
            sent: count(r.sent),
            delivered: count(r.delivered),
            clicked: count(r.clicked),
            bounced: count(r.bounced),
            replied: countOrNull(r.replied),
            clickRate: rate(r.clickRate),
            replyRate: rate(r.replyRate),
            verdict: text(r.verdict),
        })),
        promptChanges: list(raw.promptChanges).map((r) => ({
            engineId: text(r.engineId),
            engineName: text(r.engineName),
            version: count(r.version),
            createdAt: text(r.createdAt),
            source: text(r.source),
            change: text(r.change),
            sends: count(r.sends),
            replies: countOrNull(r.replies),
            replyRate: rate(r.replyRate),
            demosBooked: countOrNull(r.demosBooked),
            enough: r.enough === true,
        })),
        engineChecks: checks
            ? {
                  doubleContact: countOrNull(checks.doubleContact),
                  sentAfterReply: countOrNull(checks.sentAfterReply),
                  stuckMembers: countOrNull(checks.stuckMembers),
              }
            : null,
    };
};

/** Fills the gaps of a partial response so the page never has to guard against undefined lists. */
export const normalizeDiagnosis = (
    raw: Partial<EngagementDiagnosis> | null | undefined
): EngagementDiagnosis => {
    const to = raw?.to || raw?.from || '';
    const from = raw?.from || to;
    return {
        view: raw?.view === 'WEEKLY' ? 'WEEKLY' : 'DAILY',
        from,
        to,
        days: isNum(raw?.days) && raw.days >= 1 ? Math.floor(raw.days) : 1,
        timezone: text(raw?.timezone),
        engineId: raw?.engineId ?? null,
        generatedAt: text(raw?.generatedAt),
        problems: list(raw?.problems).map(normalizeProblem),
        moreProblems: Math.max(0, count(raw?.moreProblems)),
        stages: list(raw?.stages).map((s) => ({ stage: text(s.stage), status: text(s.status) })),
        dataGaps: list(raw?.dataGaps).map((g) => ({ code: text(g.code), names: strings(g.names) })),
        weekly: normalizeWeekly(raw?.weekly),
        errors: raw?.errors && typeof raw.errors === 'object' ? raw.errors : {},
    };
};

// ─── fetching ──────────────────────────────────────────────────────────────

/**
 * `engineId` null = all engines; `to` null = today in the institute time zone (the page leaves
 * it out rather than guess the zone, as the report does).
 */
export const fetchEngagementDiagnosis = async (
    instituteId: string,
    engineId: string | null,
    view: DiagnosisView,
    to: string | null,
    /** Skip the server's short-lived copy (the Refresh button). */
    fresh = false
): Promise<EngagementDiagnosis> => {
    const res = await authenticatedAxiosInstance.get<Partial<EngagementDiagnosis>>(
        ENGAGEMENT_DIAGNOSIS,
        {
            params: {
                instituteId,
                view,
                ...(engineId ? { engineId } : {}),
                ...(to ? { to } : {}),
                ...(fresh ? { fresh: true } : {}),
            },
        }
    );
    return normalizeDiagnosis(res.data);
};

const diagnosisQueryKey = (
    instituteId: string,
    engineId: string | null,
    view: DiagnosisView,
    to: string | null
) => ['engagement-diagnosis', instituteId, engineId, view, to] as const;

const DIAGNOSIS_STALE_MS = 3 * 60 * 1000;

/**
 * The diagnosis for one engine (or all) on the day or week ending `to`. Kept 3 minutes, like the
 * report it sits beside, and never treated as fresh while a part of it failed. A different day,
 * week or engine shows no data until it arrives: the old problems are not the new ones.
 */
export function useEngagementDiagnosis(
    instituteId: string,
    engineId: string | null,
    view: DiagnosisView,
    to: string | null,
    enabled = true
) {
    return useQuery({
        queryKey: diagnosisQueryKey(instituteId, engineId, view, to),
        queryFn: () => fetchEngagementDiagnosis(instituteId, engineId, view, to),
        enabled: enabled && !!instituteId,
        staleTime: (query) =>
            Object.keys(query.state.data?.errors ?? {}).length > 0 ? 0 : DIAGNOSIS_STALE_MS,
        refetchOnWindowFocus: false,
        // A bad date (400), no access (403) or a missing engine (404) will not fix itself.
        retry: (failureCount, error) => {
            const status = reportErrorStatus(error);
            return failureCount < 1 && !(status !== null && status >= 400 && status < 500);
        },
    });
}

/** The Refresh button's half: builds the diagnosis again and puts the answer where the page reads it. */
export function useRefreshEngagementDiagnosis(
    instituteId: string,
    engineId: string | null,
    view: DiagnosisView,
    to: string | null
) {
    const queryClient = useQueryClient();
    const [refreshing, setRefreshing] = useState(false);
    const refresh = useCallback(async () => {
        if (!instituteId) return;
        setRefreshing(true);
        try {
            const data = await fetchEngagementDiagnosis(instituteId, engineId, view, to, true);
            queryClient.setQueryData(diagnosisQueryKey(instituteId, engineId, view, to), data);
        } finally {
            setRefreshing(false);
        }
    }, [instituteId, engineId, view, to, queryClient]);
    return { refresh, refreshing };
}
