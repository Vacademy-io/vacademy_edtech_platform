import type {
    CrmAgeBucket,
    CrmCallsBlock,
    CrmCounsellorRow,
    CrmFollowupsBlock,
    CrmPipelineBlock,
    CrmSourceRow,
    CrmSummaryBlock,
} from '../-services/crm-dashboard';

export type CrmRangeDays = 7 | 30 | 90;
export const CRM_RANGE_OPTIONS: CrmRangeDays[] = [7, 30, 90];

export interface CrmWindow {
    from: string;
    to: string;
    now: string;
    todayEnd: string;
    timezone: string;
    /** yyyy-MM-dd, for Recent Leads links (its custom range takes calendar days). */
    fromDay: string;
    toDay: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const isoDay = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * The last N days in the user's clock, ending now. "now" is rounded down to the
 * minute so repeated loads hit the server cache; today's end matches the
 * Follow-ups page bucket window, so the follow-up tiles equal that page's tiles.
 */
export const buildCrmWindow = (days: CrmRangeDays, at: Date = new Date()): CrmWindow => {
    const now = new Date(at);
    now.setSeconds(0, 0);
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);
    return {
        from: start.toISOString(),
        to: now.toISOString(),
        now: now.toISOString(),
        todayEnd: todayEnd.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
        fromDay: isoDay(start),
        toDay: isoDay(now),
    };
};

/** % change against the previous period, or null when there is nothing to compare with. */
export const pctChange = (current: number, previous: number | undefined | null): number | null => {
    if (previous === undefined || previous === null) return null;
    if (previous === 0) return current === 0 ? 0 : null;
    return Math.round(((current - previous) / previous) * 100);
};

export const formatNumber = (n: number | null | undefined): string =>
    n === null || n === undefined ? '—' : Math.round(n).toLocaleString('en-IN');

export const formatPercent = (part: number, whole: number, digits = 1): string =>
    whole > 0 ? `${((part / whole) * 100).toFixed(digits)}%` : '—';

/** 38 → "38m", 135 → "2h 15m", 2900 → "2d 0h". */
export const formatMinutes = (m: number | null | undefined): string => {
    if (m === null || m === undefined || !Number.isFinite(m)) return '—';
    if (m >= 1440) return `${Math.floor(m / 1440)}d ${Math.round((m % 1440) / 60)}h`;
    if (m >= 60) return `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;
    return `${Math.max(0, Math.round(m))}m`;
};

export const formatTalkTime = (seconds: number | null | undefined): string =>
    formatMinutes(seconds === null || seconds === undefined ? null : seconds / 60);

/** GOOGLE_ADS → "Google Ads". */
export const humanizeKey = (key: string | null | undefined): string =>
    !key
        ? '—'
        : key
              .toLowerCase()
              .split('_')
              .filter(Boolean)
              .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
              .join(' ');

export interface PipelineStage {
    key: string;
    label: string;
    count: number;
}

/**
 * Pipeline in the institute's own status order and names. Statuses with no leads
 * are kept only when they are configured, so the funnel shows the real stages;
 * leads with no status at all come last as "No status".
 */
export const pipelineStages = (block: CrmPipelineBlock, noStatusLabel: string): PipelineStage[] => {
    const counts = new Map(block.counts.map((c) => [c.status_key, Number(c.n) || 0]));
    const stages: PipelineStage[] = block.statuses.map((s) => ({
        key: s.status_key,
        label: s.label || humanizeKey(s.status_key),
        count: counts.get(s.status_key) ?? 0,
    }));
    const known = new Set(stages.map((s) => s.key));
    block.counts.forEach((c) => {
        if (!known.has(c.status_key) && c.status_key !== '__NO_STATUS__') {
            stages.push({
                key: c.status_key,
                label: humanizeKey(c.status_key),
                count: Number(c.n) || 0,
            });
        }
    });
    const none = counts.get('__NO_STATUS__') ?? 0;
    if (none > 0) stages.push({ key: '__NO_STATUS__', label: noStatusLabel, count: none });
    return stages;
};

/** 7 rows (Mon..Sun) × 24 hours of connected calls. */
export const callsMatrix = (calls: CrmCallsBlock): number[][] => {
    const m = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    (calls.heatmap ?? []).forEach((c) => {
        const d = Number(c.dow) - 1;
        const h = Number(c.hour);
        if (d >= 0 && d < 7 && h >= 0 && h < 24) m[d]![h] = Number(c.n) || 0;
    });
    return m;
};

/** The busiest 3-hour window of connected calls, e.g. { from: 10, to: 13 }. */
export const bestCallWindow = (matrix: number[][]): { from: number; to: number } | null => {
    const byHour = Array.from({ length: 24 }, (_, h) =>
        matrix.reduce((s, row) => s + (row[h] ?? 0), 0)
    );
    let best = -1;
    let at = -1;
    for (let h = 0; h <= 21; h++) {
        const v = byHour[h]! + byHour[h + 1]! + byHour[h + 2]!;
        if (v > best) {
            best = v;
            at = h;
        }
    }
    return best > 0 ? { from: at, to: at + 3 } : null;
};

export const AGE_BUCKETS: CrmAgeBucket[] = ['TODAY', 'D1_3', 'D4_7', 'D8_14', 'D15_PLUS'];

export type InsightTone = 'success' | 'danger' | 'warning' | 'info';
export interface CrmInsight {
    id: string;
    tone: InsightTone;
    /** i18n key under crmDashboard:insights and its values. */
    titleKey: string;
    textKey: string;
    values: Record<string, string | number>;
    link: string;
}

/**
 * Up to four plain-language observations, worst news first. Each one names the
 * thing to act on and links to the list that shows it.
 */
export const buildInsights = (input: {
    summary?: CrmSummaryBlock;
    followups?: CrmFollowupsBlock;
    sources?: CrmSourceRow[];
    counsellors?: CrmCounsellorRow[];
}): CrmInsight[] => {
    const out: CrmInsight[] = [];
    const { summary, followups, sources, counsellors } = input;

    const worst = (counsellors ?? [])
        .filter((c) => c.overdue > 0)
        .sort((a, b) => b.overdue - a.overdue)[0];
    if (worst) {
        out.push({
            id: 'overdueCounsellor',
            tone: 'danger',
            titleKey: 'insights.overdueCounsellor.title',
            textKey: 'insights.overdueCounsellor.text',
            values: { name: worst.name || '—', count: worst.overdue },
            link: `/audience-manager/follow-ups?bucket=overdue`,
        });
    }

    if (summary && summary.new_leads > 0) {
        const uncontacted = summary.new_leads - summary.contacted;
        if (uncontacted > 0) {
            out.push({
                id: 'uncontacted',
                tone: 'warning',
                titleKey: 'insights.uncontacted.title',
                textKey: 'insights.uncontacted.text',
                values: {
                    count: formatNumber(uncontacted),
                    share: formatPercent(uncontacted, summary.new_leads, 0),
                },
                link: '/audience-manager/recent-leads',
            });
        }
    }

    const rated = (sources ?? []).filter((s) => s.leads >= 10);
    const bestSource = rated.sort((a, b) => b.converted / b.leads - a.converted / a.leads)[0];
    if (bestSource && bestSource.converted > 0) {
        out.push({
            id: 'bestSource',
            tone: 'success',
            titleKey: 'insights.bestSource.title',
            textKey: 'insights.bestSource.text',
            values: {
                source: humanizeKey(bestSource.source),
                rate: formatPercent(bestSource.converted, bestSource.leads),
                count: formatNumber(bestSource.leads),
            },
            link: '/audience-manager/reports?tab=utm',
        });
    }

    const top = (counsellors ?? [])
        .filter((c) => c.converted > 0)
        .sort((a, b) => b.converted - a.converted)[0];
    if (top) {
        out.push({
            id: 'topCounsellor',
            tone: 'info',
            titleKey: 'insights.topCounsellor.title',
            textKey: 'insights.topCounsellor.text',
            values: {
                name: top.name || '—',
                count: top.converted,
                rate: formatPercent(top.converted, top.assigned),
            },
            link: '/counsellors',
        });
    }

    if (out.length < 4 && followups && followups.today > 0) {
        out.push({
            id: 'dueToday',
            tone: 'warning',
            titleKey: 'insights.dueToday.title',
            textKey: 'insights.dueToday.text',
            values: { count: formatNumber(followups.today) },
            link: '/audience-manager/follow-ups?bucket=today',
        });
    }
    return out.slice(0, 4);
};
