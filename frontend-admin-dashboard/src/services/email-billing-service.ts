/**
 * Email billing: what the institute's emails cost.
 *
 * The first `freeUnitsPerMonth` emails each calendar month (India time) are free; after that each
 * email costs `creditsPerUnit` credits (0.04 → 25 emails per credit). An "email" here is one
 * recipient copy — CC/BCC copies count, and every full MB of attachments adds one more.
 * Login codes, password resets and login details are never counted. Emails the institute could not
 * pay for are held back and can be resent from Settings → Email usage after a top-up.
 */

import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { NOTIFICATION_SERVICE_BASE } from '@/constants/urls';

const EMAIL_BILLING_BASE = `${NOTIFICATION_SERVICE_BASE}/email-billing`;

/** FREE is never counted, ESSENTIAL is charged but never blocked, BILLABLE is blocked when unpaid. */
export type EmailBillingClass = 'FREE' | 'ESSENTIAL' | 'BILLABLE' | 'EXCLUDED';

export interface EmailClassUsage {
    emails: number;
    units: number;
}

export interface EmailDayUsage {
    /** YYYY-MM-DD */
    date: string;
    emails: number;
    units: number;
    chargeableUnits: number;
}

export interface EmailUsageSummary {
    /** YYYY-MM */
    month: string;
    freeUnitsPerMonth: number;
    freeUnitsUsed: number;
    freeUnitsRemaining: number;
    chargeableUnits: number;
    unitsBeyondFree: number;
    creditsPerUnit: number;
    /** Already on the credit ledger this month. */
    chargedCredits: number;
    /** Used but not charged yet — charges run hourly. */
    pendingCredits: number;
    /** Only known for the current month. */
    balance: number | null;
    /** balance − pendingCredits. Only known for the current month. */
    availableCredits: number | null;
    enforced: boolean;
    exempt: boolean;
    blockedCount: number;
    byClass: Partial<Record<EmailBillingClass, EmailClassUsage>>;
    daily: EmailDayUsage[];
    /** Provider events this month: SEND, DELIVERY, OPEN, CLICK, BOUNCE, COMPLAINT, … */
    delivery: Record<string, number>;
}

export interface EmailCostEstimate {
    billingClass: EmailBillingClass | null;
    units: number;
    freeUnitsPerMonth: number;
    freeUnitsRemaining: number;
    chargeableUnits: number;
    credits: number;
    creditsPerUnit: number;
    balance: number | null;
    pendingCredits: number;
    availableCredits: number | null;
    enforced: boolean;
    /** false (only when enforced) means the send will be refused. */
    allowed: boolean;
}

export interface BlockedEmail {
    id: string;
    to: string;
    subject: string | null;
    units: number;
    hasAttachments: boolean;
    /** The attachments were not kept, so this email cannot be resent. */
    attachmentsTooLargeToKeep: boolean;
    createdAt: string | number | number[] | null;
}

export interface BlockedEmailPage {
    total: number;
    page: number;
    size: number;
    items: BlockedEmail[];
}

export interface ResendBlockedResult {
    resent: number;
    skipped: number;
    stillBlocked: number;
    message: string;
}

export const emailBillingKeys = {
    all: ['email-billing'] as const,
    usage: (instituteId: string, month: string) =>
        ['email-billing', 'usage', instituteId, month] as const,
    blocked: (instituteId: string, page: number, size: number) =>
        ['email-billing', 'blocked', instituteId, page, size] as const,
    estimate: (params: EmailCostEstimateParams) => ['email-billing', 'estimate', params] as const,
};

/** Spring may write a LocalDate as "2026-11-08" or as [2026, 11, 8]; accept both. */
function toIsoDate(value: unknown): string {
    if (Array.isArray(value) && value.length >= 3) {
        const [y, m, d] = value as number[];
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    return String(value ?? '');
}

/** An Instant arrives as an ISO string, epoch seconds (possibly fractional) or an array. */
export function parseBlockedAt(value: BlockedEmail['createdAt']): Date | null {
    if (value == null) return null;
    if (typeof value === 'number') {
        // Seconds when written as a timestamp by Jackson; milliseconds would be far larger.
        return new Date(value < 1e12 ? value * 1000 : value);
    }
    if (Array.isArray(value)) {
        const [y, mo, d, h = 0, mi = 0, s = 0] = value;
        return new Date(Date.UTC(y ?? 1970, (mo ?? 1) - 1, d ?? 1, h, mi, s));
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * `fromMonth` (YYYY-MM, as the server reports it) and the `count - 1` months before it, newest
 * first. Plain calendar arithmetic: the billing month itself always comes from the server, which
 * counts it in India time, so the browser's timezone never decides it.
 */
export function recentBillingMonths(fromMonth: string, count = 12): string[] {
    const [y, m] = fromMonth.split('-').map(Number);
    const months: string[] = [];
    for (let i = 0; i < count; i++) {
        const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1 - i, 1));
        months.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`);
    }
    return months;
}

export async function fetchEmailUsage(
    instituteId: string,
    month?: string
): Promise<EmailUsageSummary> {
    const { data } = await authenticatedAxiosInstance.get<EmailUsageSummary>(
        `${EMAIL_BILLING_BASE}/usage`,
        { params: { instituteId, ...(month ? { month } : {}) } }
    );
    return {
        ...data,
        byClass: data.byClass ?? {},
        delivery: data.delivery ?? {},
        daily: (data.daily ?? []).map((d) => ({ ...d, date: toIsoDate(d.date) })),
    };
}

export interface EmailCostEstimateParams {
    instituteId: string;
    /** People the send goes to. */
    recipients: number;
    billingClass?: EmailBillingClass;
    /** CC/BCC copies per email. */
    copies?: number;
    /** Attachment size per email. */
    attachmentBytes?: number;
}

export async function fetchEmailCostEstimate(
    params: EmailCostEstimateParams
): Promise<EmailCostEstimate> {
    const { data } = await authenticatedAxiosInstance.get<EmailCostEstimate>(
        `${EMAIL_BILLING_BASE}/estimate`,
        {
            params: {
                instituteId: params.instituteId,
                recipients: params.recipients,
                billingClass: params.billingClass ?? 'BILLABLE',
                copies: params.copies ?? 0,
                attachmentBytes: params.attachmentBytes ?? 0,
            },
        }
    );
    return data;
}

export async function fetchBlockedEmails(
    instituteId: string,
    page = 0,
    size = 50
): Promise<BlockedEmailPage> {
    const { data } = await authenticatedAxiosInstance.get<BlockedEmailPage>(
        `${EMAIL_BILLING_BASE}/blocked`,
        { params: { instituteId, page, size } }
    );
    return { ...data, items: data.items ?? [] };
}

/** Resend the given held-back emails; no ids resends all of them (up to 200 per call). */
export async function resendBlockedEmails(
    instituteId: string,
    ids?: string[]
): Promise<ResendBlockedResult> {
    const { data } = await authenticatedAxiosInstance.post<ResendBlockedResult>(
        `${EMAIL_BILLING_BASE}/blocked/resend`,
        ids ?? [],
        { params: { instituteId } }
    );
    return data;
}

export async function discardBlockedEmails(
    instituteId: string,
    ids: string[]
): Promise<{ discarded: number }> {
    const { data } = await authenticatedAxiosInstance.post<{ discarded: number }>(
        `${EMAIL_BILLING_BASE}/blocked/discard`,
        ids,
        { params: { instituteId } }
    );
    return data;
}

/** {@code month} undefined = the server's current billing month. */
export function useEmailUsage(instituteId: string | undefined, month: string | undefined) {
    return useQuery({
        queryKey: emailBillingKeys.usage(instituteId ?? '', month ?? 'current'),
        enabled: !!instituteId,
        staleTime: 60 * 1000,
        queryFn: () => fetchEmailUsage(instituteId ?? '', month),
    });
}

export function useBlockedEmails(instituteId: string | undefined, page: number, size: number) {
    return useQuery({
        queryKey: emailBillingKeys.blocked(instituteId ?? '', page, size),
        enabled: !!instituteId,
        staleTime: 30 * 1000,
        placeholderData: (prev) => prev,
        queryFn: () => fetchBlockedEmails(instituteId ?? '', page, size),
    });
}

/**
 * The cost of a send before it goes out. Fails open: while loading, on error, or with nothing to
 * send, `allowed` is true — a missing estimate must never stop an institute from sending.
 */
export function useEmailCostEstimate(params: EmailCostEstimateParams | null, enabled = true) {
    const active = enabled && !!params?.instituteId && (params?.recipients ?? 0) > 0;
    const query = useQuery({
        queryKey: emailBillingKeys.estimate(params ?? { instituteId: '', recipients: 0 }),
        enabled: active,
        staleTime: 30 * 1000,
        retry: false,
        refetchOnWindowFocus: false,
        queryFn: () => fetchEmailCostEstimate(params as EmailCostEstimateParams),
    });
    const estimate = active && !query.isError ? query.data ?? null : null;
    return {
        estimate,
        isLoading: active && query.isLoading,
        allowed: estimate ? estimate.allowed !== false : true,
    };
}
