import { formatMoney } from '@/utils/payment-currency';
import type {
    DashboardBatchRow,
    DashboardSlice,
    PaymentDashboard,
} from '@/services/payment-dashboard';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

/** The period presets on the dashboard toolbar. */
export type DashboardPeriodKey = 'this_month' | '3m' | 'fy' | '12m' | 'all' | 'custom';

export const DASHBOARD_PERIODS: { key: Exclude<DashboardPeriodKey, 'custom'>; label: string }[] = [
    { key: 'this_month', label: 'This month' },
    { key: '3m', label: '3 months' },
    { key: 'fy', label: 'This FY' },
    { key: '12m', label: '12 months' },
    { key: 'all', label: 'All time' },
];

/**
 * A preset as a concrete window, cut at the admin's local midnights. All time has no start.
 * "3 months" and "12 months" include the current month (e.g. Jul–Sep for 3 months in September),
 * and the financial year runs April–March.
 */
export const resolveDashboardPeriod = (
    key: Exclude<DashboardPeriodKey, 'custom'>,
    now: Date = new Date()
): { start?: Date; end: Date } => {
    const end = new Date(now);
    const y = now.getFullYear();
    const m = now.getMonth();
    switch (key) {
        case 'this_month':
            return { start: new Date(y, m, 1), end };
        case '3m':
            return { start: new Date(y, m - 2, 1), end };
        case '12m':
            return { start: new Date(y, m - 11, 1), end };
        case 'fy':
            return { start: new Date(m >= 3 ? y : y - 1, 3, 1), end };
        case 'all':
        default:
            return { end };
    }
};

/** The API wants a UTC local date-time without the zone suffix (YYYY-MM-DDTHH:mm:ss). */
export const toApiDateTime = (d: Date): string => d.toISOString().slice(0, 19);

/** ₹14.2L / ₹1.3Cr / ₹85K for INR; the locale's compact form for anything else. */
export const formatCompact = (amount: number, currency: string | null | undefined): string => {
    const cur = (currency || 'INR').toUpperCase();
    const n = Number.isFinite(amount) ? amount : 0;
    if (cur === 'INR') {
        const abs = Math.abs(n);
        const sign = n < 0 ? '-' : '';
        const trim = (v: number) => (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '');
        if (abs >= 1e7) return `${sign}₹${trim(abs / 1e7)}Cr`;
        if (abs >= 1e5) return `${sign}₹${trim(abs / 1e5)}L`;
        if (abs >= 1e3) return `${sign}₹${trim(abs / 1e3)}K`;
        return `${sign}₹${Math.round(abs)}`;
    }
    return formatMoney(n, cur, { notation: 'compact', maximumFractionDigits: 1 });
};

/** Exact amount for tooltips and tables; rupees in Indian grouping (₹4,27,000). */
export const formatFull = (amount: number, currency: string | null | undefined): string => {
    const cur = (currency || 'INR').toUpperCase();
    const n = Number.isFinite(amount) ? amount : 0;
    if (cur === 'INR') {
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            maximumFractionDigits: 0,
        }).format(n);
    }
    return formatMoney(n, cur, { maximumFractionDigits: 0 });
};

/** Change from previous to current in percent, or null when there is nothing to compare with. */
export const percentChange = (
    current: number,
    previous: number | null | undefined
): number | null => {
    if (previous === null || previous === undefined || !Number.isFinite(previous)) return null;
    if (previous === 0) return current === 0 ? 0 : null;
    return ((current - previous) / previous) * 100;
};

/** Share of the whole fee (collected over all time + still owed) that has come in. */
export const collectionRate = (collectedAllTime: number, outstanding: number): number | null => {
    const total = collectedAllTime + outstanding;
    return total > 0 ? (collectedAllTime / total) * 100 : null;
};

/**
 * Courses without levels or sessions get placeholder ones named "default" / "DEFAULT" — they
 * mean nothing to an admin, so they are never shown.
 */
export const isPlaceholderName = (name: string | null | undefined): boolean =>
    !name || /^default$/i.test(name.trim());

/** A batch's level and session, leaving out placeholder names; empty when there are none. */
export const batchParts = (level?: string | null, session?: string | null): string =>
    [level, session].filter((n) => !isPlaceholderName(n)).join(' · ');

/**
 * What a batch is called on the page: its level and session ("Class 12 · 2026-27"), or the
 * course name when those are placeholders.
 */
export const batchLabel = (b: DashboardBatchRow): string => {
    if (!b.package_session_id) return 'Not linked to a batch';
    return batchParts(b.level_name, b.session_name) || b.package_name || 'Batch';
};

/**
 * Financial years worth drawing: from the first one with any money, but always at least the
 * last two so the current year has something to stand next to.
 */
export const visibleYears = <T extends { collected: number }>(years: T[]): T[] => {
    const first = years.findIndex((y) => y.collected > 0);
    const from = first < 0 ? years.length - 2 : Math.min(first, years.length - 2);
    return years.slice(Math.max(0, from));
};

export interface CourseRow {
    key: string;
    name: string;
    collected: number;
    collectedAllTime: number;
    overdue: number;
    stillToCome: number;
    /** The course's batches seen in the data, so a click can filter by them. */
    batches: { id: string; label: string }[];
}

/** Batches rolled up to their course; money on no batch becomes its own row, last. */
export const toCourseRows = (batches: DashboardBatchRow[]): CourseRow[] => {
    const byCourse = new Map<string, CourseRow>();
    for (const b of batches) {
        const key = b.package_id ?? '__none__';
        const row = byCourse.get(key) ?? {
            key,
            name: b.package_id
                ? b.package_name ||
                  `Untitled ${getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}`
                : `Not linked to a ${getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}`,
            collected: 0,
            collectedAllTime: 0,
            overdue: 0,
            stillToCome: 0,
            batches: [],
        };
        row.collected += b.collected;
        row.collectedAllTime += b.collected_all_time;
        row.overdue += b.overdue;
        row.stillToCome += b.still_to_come;
        if (b.package_session_id)
            row.batches.push({ id: b.package_session_id, label: batchLabel(b) });
        byCourse.set(key, row);
    }
    return [...byCourse.values()].sort((a, b) =>
        a.key === '__none__' ? 1 : b.key === '__none__' ? -1 : b.collected - a.collected
    );
};

export const SOURCE_LABELS: Record<string, string> = {
    ONLINE: 'Online checkout',
    LIVE_SESSION: 'Live class registration',
    MANUAL: 'Manual (admin)',
    SUB_ORG: 'Sub-organisation',
};

const GATEWAY_LABELS: Record<string, string> = {
    RAZORPAY: 'Razorpay',
    STRIPE: 'Stripe',
    CASHFREE: 'Cashfree',
    PHONEPE: 'PhonePe',
    EWAY: 'eWAY',
    PAYPAL: 'PayPal',
};

/** Payment vendors as the admin knows them; MANUAL and OFFLINE are the same thing to them. */
export const toMethodSlices = (
    methods: DashboardSlice[]
): { label: string; amount: number; payments: number }[] => {
    const merged = new Map<string, { label: string; amount: number; payments: number }>();
    for (const m of methods) {
        const key = (m.key || 'OTHER').toUpperCase();
        const label =
            key === 'MANUAL' || key === 'OFFLINE'
                ? 'Offline / recorded by admin'
                : GATEWAY_LABELS[key] ?? 'Other';
        const row = merged.get(label) ?? { label, amount: 0, payments: 0 };
        row.amount += m.amount;
        row.payments += m.payments;
        merged.set(label, row);
    }
    return [...merged.values()].sort((a, b) => b.amount - a.amount);
};

export const AGEING_LABELS: Record<string, string> = {
    D0_30: '0–30 days',
    D31_60: '31–60 days',
    D61_90: '61–90 days',
    D90_PLUS: '90+ days',
    UNDATED: 'No due date',
};

export const AGEING_ORDER = ['D0_30', 'D31_60', 'D61_90', 'D90_PLUS', 'UNDATED'];

/** "Oct" from "2025-10"; with the year when asked. */
export const monthLabel = (bucket: string, withYear = false): string => {
    const [y, m] = bucket.split('-').map(Number);
    if (!y || !m) return bucket;
    return new Date(y, m - 1, 1).toLocaleDateString('en-IN', {
        month: 'short',
        ...(withYear ? { year: 'numeric' } : {}),
    });
};

export interface Highlight {
    tone: 'brand' | 'info' | 'danger' | 'success';
    text: string;
}

/**
 * Plain-language takeaways from the figures. Each is only stated when the data supports it — no
 * "best month" without a month that collected anything, no overdue warning without overdue money.
 */
export const buildHighlights = (d: PaymentDashboard): Highlight[] => {
    const out: Highlight[] = [];
    const cur = d.currency;
    const last12 = d.months.slice(-12);
    const prior12 = d.months.slice(-24, -12);

    const best = last12.reduce<(typeof last12)[number] | null>(
        (b, m) => (m.collected > (b?.collected ?? 0) ? m : b),
        null
    );
    if (best) {
        const idx = last12.indexOf(best);
        const yearAgo = prior12[idx]?.collected ?? 0;
        const change = percentChange(best.collected, yearAgo);
        out.push({
            tone: 'brand',
            text: `${monthLabel(best.bucket, true)} was the best month of the last 12 — ${formatCompact(
                best.collected,
                cur
            )} collected${change !== null && yearAgo > 0 ? `, ${Math.abs(Math.round(change))}% ${change >= 0 ? 'more' : 'less'} than a year earlier` : ''}.`,
        });
    }

    const courses = toCourseRows(d.batches).filter((c) => c.key !== '__none__' && c.collected > 0);
    const periodTotal = d.kpis.collected;
    if (courses.length > 0 && periodTotal > 0) {
        const top = courses[0]!;
        out.push({
            tone: 'info',
            text: `${top.name} brought in ${Math.round((top.collected / periodTotal) * 100)}% of the money collected in this period (${formatCompact(top.collected, cur)}).`,
        });
    }

    const late = d.ageing.find((a) => a.bucket === 'D90_PLUS');
    if (late && late.amount > 0) {
        out.push({
            tone: 'danger',
            text: `${formatCompact(late.amount, cur)} has been overdue for more than 90 days across ${late.learners} learner${late.learners === 1 ? '' : 's'} — the oldest balances to follow up.`,
        });
    } else if (d.kpis.overdue <= 0) {
        out.push({ tone: 'success', text: 'Nothing is overdue right now.' });
    }

    if (d.kpis.due_soon > 0) {
        out.push({
            tone: 'success',
            text: `${formatCompact(d.kpis.due_soon, cur)} falls due in the next ${d.kpis.upcoming_days} days from ${d.kpis.learners_due_soon} learner${d.kpis.learners_due_soon === 1 ? '' : 's'}.`,
        });
    }
    return out;
};

/** Six intensity steps for the calendar: 0 = nothing received, 5 = the busiest days. */
export const heatLevel = (value: number, max: number): number => {
    if (value <= 0 || max <= 0) return 0;
    return Math.min(5, Math.max(1, Math.ceil((value / max) * 5)));
};
