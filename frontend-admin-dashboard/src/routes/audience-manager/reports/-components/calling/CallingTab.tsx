/**
 * CallingTab — the "Calling" tab of the Reports Center
 * (/audience-manager/reports?tab=calling). Lazy-imported by the Reports shell;
 * the shell owns the page chrome + filter bar and passes the applied window in
 * via props (contract-fixed default export + props shape — do not change).
 *
 * Sections (top to bottom):
 *   1. KPI row — total dials · connected · connect rate · total talk time,
 *      derived client-side from the calls-daily `days[]` payload.
 *   2. Daily call activity — hand-rolled SVG dual-line series (dials vs
 *      connected), same idiom as the Overview tab's TrendChart.
 *   3. Per-counsellor table — sortable, outcome chips, client-side CSV export.
 *   4. Hourly heatmap — 7×24 CSS grid, cell intensity = dials on the
 *      primary-* token scale, native-title tooltips.
 *
 * Day/hour buckets arrive pre-bucketed in the institute's report timezone
 * (Settings → Lead settings → Reports), so no client-side TZ math happens here.
 *
 * The reports endpoints may not exist on the backend yet (post-merge,
 * pre-deploy) — a 404 (or the gateway's empty 403 for unknown paths) renders a
 * single "deploy pending" notice instead of broken sections.
 */
import { Fragment, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
    ArrowsClockwise,
    CaretDown,
    CaretUp,
    ChartLineUp,
    DownloadSimple,
    GridFour,
    Percent,
    Phone,
    PhoneCall,
    Timer,
    Users,
    WarningCircle,
    Wrench,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { MyButton } from '@/components/design-system/button';
import { CallIntelligenceSummary } from '@/components/shared/leads';
import { TELEPHONY_CALL_STATUSES, humanizeCallStatus } from '@/hooks/use-lead-report-settings';
import {
    callsDailyQueryKey,
    callsHeatmapQueryKey,
    fetchCallsDaily,
    fetchCallsHeatmap,
    isReportEndpointMissing,
    type CallingReportParams,
    type CallsByCounsellorRow,
    type CallsDailyPoint,
    type CallsHeatmapCell,
} from './calling-reports-service';
import { buildCsv, downloadCsv } from './calling-csv';

// ── Formatting helpers ─────────────────────────────────────────────────

function fmtNumber(n: number | null | undefined): string {
    if (n == null || Number.isNaN(n)) return '—';
    return n.toLocaleString();
}

function fmtPct(p: number | null | undefined): string {
    if (p == null || Number.isNaN(p)) return '—';
    return `${p.toFixed(1)}%`;
}

/** Total talk time as h:mm (e.g. 7380s → "2:03"). */
function fmtTalkHm(seconds: number | null | undefined): string {
    if (seconds == null || Number.isNaN(seconds)) return '—';
    const total = Math.max(0, Math.round(seconds));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    return `${h}:${String(m).padStart(2, '0')}`;
}

/** Per-call duration as m:ss (e.g. 275s → "4:35"). */
function fmtMinSec(seconds: number | null | undefined): string {
    if (seconds == null || Number.isNaN(seconds)) return '—';
    const total = Math.max(0, Math.round(seconds));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

/** Connect-rate buckets — green ≥40%, amber 20–39.99%, red <20%. */
function connectRateClass(rate: number | null | undefined): string {
    if (rate == null) return 'text-neutral-400';
    if (rate >= 40) return 'text-success-700 font-semibold';
    if (rate >= 20) return 'text-warning-700 font-medium';
    return 'text-danger-600 font-medium';
}

/** Terminal CALL_STATUS → chip classes. Static enumeration so Tailwind keeps them. */
const OUTCOME_CHIP_CLASSES: Record<string, string> = {
    COMPLETED: 'bg-success-50 text-success-700',
    NO_ANSWER: 'bg-warning-50 text-warning-700',
    BUSY: 'bg-warning-100 text-warning-700',
    FAILED: 'bg-danger-50 text-danger-600',
    CANCELLED: 'bg-neutral-100 text-neutral-600',
    IN_PROGRESS: 'bg-info-50 text-info-700',
};
const OUTCOME_CHIP_FALLBACK = 'bg-neutral-100 text-neutral-600';

/** Union of outcome keys across rows, ordered by the backend enum's lifecycle order. */
function orderedOutcomeKeys(rows: CallsByCounsellorRow[]): string[] {
    const present = new Set<string>();
    for (const r of rows) {
        for (const k of Object.keys(r.outcomes ?? {})) present.add(k);
    }
    const enumOrder = TELEPHONY_CALL_STATUSES.filter((s) => present.has(s));
    const unknown = [...present].filter(
        (k) => !(TELEPHONY_CALL_STATUSES as readonly string[]).includes(k)
    );
    return [...enumOrder, ...unknown.sort()];
}

// ── Main component (contract-fixed export + props) ─────────────────────

export default function CallingTab(props: {
    instituteId: string;
    fromDate: string;
    toDate: string;
    teamId?: string;
    counsellorUserId?: string;
}) {
    const { instituteId, fromDate, toDate, teamId, counsellorUserId } = props;
    const { t } = useTranslation('audienceManagerCallingTab');
    const params: CallingReportParams = { instituteId, fromDate, toDate, teamId, counsellorUserId };

    // Don't burn retries on endpoints that aren't deployed yet.
    const retryUnlessMissing = (failureCount: number, error: unknown) =>
        !isReportEndpointMissing(error) && failureCount < 2;

    const dailyQuery = useQuery({
        queryKey: callsDailyQueryKey(params),
        queryFn: () => fetchCallsDaily(params),
        enabled: !!instituteId,
        staleTime: 60_000,
        retry: retryUnlessMissing,
    });
    const heatmapQuery = useQuery({
        queryKey: callsHeatmapQueryKey(params),
        queryFn: () => fetchCallsHeatmap(params),
        enabled: !!instituteId,
        staleTime: 60_000,
        retry: retryUnlessMissing,
    });

    const daily = dailyQuery.data;
    const days = useMemo(() => daily?.days ?? [], [daily]);
    const byCounsellor = useMemo(() => daily?.by_counsellor ?? [], [daily]);

    // KPI totals derived client-side from days[] (contract: no totals object on the wire).
    const totals = useMemo(() => {
        const dials = days.reduce((s, d) => s + d.dials, 0);
        const connected = days.reduce((s, d) => s + d.connected, 0);
        const talkSeconds = days.reduce((s, d) => s + d.talk_seconds, 0);
        return {
            dials,
            connected,
            connectRate: dials > 0 ? (connected / dials) * 100 : null,
            talkSeconds,
        };
    }, [days]);

    if (!instituteId) {
        return <EmptyBlock message={t('empty.pickInstitute')} />;
    }

    // Both endpoints ship in the same backend release — one notice for the tab.
    if (
        (dailyQuery.isError && isReportEndpointMissing(dailyQuery.error)) ||
        (heatmapQuery.isError && isReportEndpointMissing(heatmapQuery.error))
    ) {
        return <DeployPendingNotice />;
    }

    const dailyLoading = dailyQuery.isLoading;

    const exportDailyCsv = () => {
        const csv = buildCsv(
            [
                t('csv.daily.date'),
                t('csv.daily.dials'),
                t('csv.daily.connected'),
                t('csv.daily.connectRate'),
                t('csv.daily.talkTime'),
            ],
            days.map((d) => [
                d.date,
                d.dials,
                d.connected,
                d.connect_rate != null ? d.connect_rate.toFixed(1) : '',
                d.talk_seconds,
            ])
        );
        downloadCsv(`calling-daily-${fromDate}-to-${toDate}.csv`, csv);
    };

    const exportCounsellorCsv = () => {
        const outcomeKeys = orderedOutcomeKeys(byCounsellor);
        const csv = buildCsv(
            [
                t('csv.counsellor.counsellor'),
                t('csv.counsellor.dials'),
                t('csv.counsellor.connected'),
                t('csv.counsellor.connectRate'),
                t('csv.counsellor.talkTime'),
                t('csv.counsellor.avgCall'),
                ...outcomeKeys.map(humanizeCallStatus),
            ],
            byCounsellor.map((r) => [
                r.name,
                r.dials,
                r.connected,
                r.connect_rate != null ? r.connect_rate.toFixed(1) : '',
                r.talk_seconds,
                r.avg_call_seconds != null ? Math.round(r.avg_call_seconds) : '',
                ...outcomeKeys.map((k) => r.outcomes?.[k] ?? 0),
            ])
        );
        downloadCsv(`calling-counsellors-${fromDate}-to-${toDate}.csv`, csv);
    };

    const fromMillis = Number.isNaN(new Date(fromDate).getTime())
        ? undefined
        : new Date(fromDate).getTime();
    const toMillis = Number.isNaN(new Date(`${toDate}T23:59:59`).getTime())
        ? undefined
        : new Date(`${toDate}T23:59:59`).getTime();

    return (
        <div className="flex flex-col gap-6">
            {/* 0 — Call Intelligence roll-up (team scope = acting user's reporting line) */}
            <CallIntelligenceSummary
                mode="team"
                instituteId={instituteId}
                fromMillis={fromMillis}
                toMillis={toMillis}
            />
            {/* 1 — KPI row */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <KpiStat
                    label={t('kpi.totalDials.label')}
                    value={fmtNumber(totals.dials)}
                    sub={
                        days.length > 0
                            ? t('kpi.totalDials.sub', { count: days.length })
                            : undefined
                    }
                    icon={<Phone size={20} weight="bold" />}
                    tone="primary"
                    loading={dailyLoading}
                />
                <KpiStat
                    label={t('kpi.connected.label')}
                    value={fmtNumber(totals.connected)}
                    sub={
                        totals.dials > 0
                            ? t('kpi.connected.sub', {
                                  count: totals.dials,
                                  dials: fmtNumber(totals.dials),
                              })
                            : undefined
                    }
                    icon={<PhoneCall size={20} weight="bold" />}
                    tone="success"
                    loading={dailyLoading}
                />
                <KpiStat
                    label={t('kpi.connectRate.label')}
                    value={fmtPct(totals.connectRate)}
                    sub={t('kpi.connectRate.sub')}
                    icon={<Percent size={20} weight="bold" />}
                    tone="info"
                    loading={dailyLoading}
                />
                <KpiStat
                    label={t('kpi.talkTime.label')}
                    value={fmtTalkHm(totals.talkSeconds)}
                    sub={t('kpi.talkTime.sub')}
                    icon={<Timer size={20} weight="bold" />}
                    tone="warning"
                    loading={dailyLoading}
                />
            </div>

            {/* 2 — Daily dials vs connected */}
            <section className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <ChartLineUp size={18} className="text-neutral-500" />
                        <h2 className="text-base font-semibold text-neutral-900">
                            {t('dailyChart.heading')}
                        </h2>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-4 text-xs text-neutral-600">
                            <span className="flex items-center gap-1">
                                <span className="size-2 rounded-full bg-blue-500" />{' '}
                                {t('dailyChart.legendDials')}
                            </span>
                            <span className="flex items-center gap-1">
                                <span className="size-2 rounded-full bg-green-600" />{' '}
                                {t('dailyChart.legendConnected')}
                            </span>
                        </div>
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            onClick={exportDailyCsv}
                            disable={days.length === 0}
                        >
                            <span className="flex items-center gap-2">
                                <DownloadSimple size={14} />
                                {t('dailyChart.exportCsv')}
                            </span>
                        </MyButton>
                    </div>
                </div>
                {dailyLoading ? (
                    <LoadingBlock />
                ) : dailyQuery.isError ? (
                    <ErrorNotice onRetry={() => dailyQuery.refetch()} />
                ) : days.length === 0 ? (
                    <EmptyBlock message={t('empty.noCallsInRange')} />
                ) : (
                    <DailyCallsChart points={days} />
                )}
            </section>

            {/* 3 — Per-counsellor table */}
            <section className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <Users size={18} className="text-neutral-500" />
                        <h2 className="text-base font-semibold text-neutral-900">
                            {t('counsellorTable.heading')}
                        </h2>
                        {byCounsellor.length > 0 && (
                            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
                                {byCounsellor.length}
                            </span>
                        )}
                    </div>
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        onClick={exportCounsellorCsv}
                        disable={byCounsellor.length === 0}
                    >
                        <span className="flex items-center gap-2">
                            <DownloadSimple size={14} />
                            {t('counsellorTable.exportCsv')}
                        </span>
                    </MyButton>
                </div>
                {dailyLoading ? (
                    <LoadingBlock />
                ) : dailyQuery.isError ? (
                    <ErrorNotice onRetry={() => dailyQuery.refetch()} />
                ) : byCounsellor.length === 0 ? (
                    <EmptyBlock message={t('empty.noCounsellorActivity')} />
                ) : (
                    <CounsellorCallsTable rows={byCounsellor} />
                )}
            </section>

            {/* 4 — Hourly heatmap */}
            <section className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <GridFour size={18} className="text-neutral-500" />
                        <h2 className="text-base font-semibold text-neutral-900">
                            {t('heatmap.heading')}
                        </h2>
                    </div>
                    <span className="text-xs text-neutral-500">{t('heatmap.timezoneNote')}</span>
                </div>
                {heatmapQuery.isLoading ? (
                    <LoadingBlock />
                ) : heatmapQuery.isError ? (
                    <ErrorNotice onRetry={() => heatmapQuery.refetch()} />
                ) : (heatmapQuery.data?.cells.length ?? 0) === 0 ? (
                    <EmptyBlock message={t('empty.noCallsInRange')} />
                ) : (
                    <CallsHeatmap cells={heatmapQuery.data?.cells ?? []} />
                )}
            </section>
        </div>
    );
}

// ── Shared states ──────────────────────────────────────────────────────

/** The reports endpoints aren't on this backend yet (immediate post-merge reality). */
function DeployPendingNotice() {
    const { t } = useTranslation('audienceManagerCallingTab');
    return (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-10 text-center">
            <Wrench size={28} className="text-neutral-400" />
            <p className="text-sm font-medium text-neutral-700">{t('deployPending.title')}</p>
            <p className="max-w-md text-xs text-neutral-500">
                {t('deployPending.description')}
            </p>
        </div>
    );
}

function ErrorNotice({ onRetry }: { onRetry: () => void }) {
    const { t } = useTranslation('audienceManagerCallingTab');
    return (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
            <WarningCircle size={24} className="text-danger-500" />
            <p className="text-sm text-neutral-600">{t('error.loadFailed')}</p>
            <MyButton buttonType="secondary" scale="small" onClick={onRetry}>
                <span className="flex items-center gap-2">
                    <ArrowsClockwise size={14} />
                    {t('error.retry')}
                </span>
            </MyButton>
        </div>
    );
}

function LoadingBlock() {
    return <div className="h-40 animate-pulse rounded-lg bg-neutral-100" />;
}

function EmptyBlock({ message }: { message: string }) {
    return (
        <div className="flex h-32 items-center justify-center text-sm text-neutral-400">
            {message}
        </div>
    );
}

// ── KPI card ───────────────────────────────────────────────────────────

interface KpiStatProps {
    label: string;
    value: string;
    sub?: string | undefined;
    icon: ReactNode;
    tone: 'primary' | 'success' | 'info' | 'warning';
    loading?: boolean;
}
function KpiStat({ label, value, sub, icon, tone, loading }: KpiStatProps) {
    // Mirrors the Overview tab's KpiCard tone palette for visual consistency.
    const toneToIconClass: Record<KpiStatProps['tone'], string> = {
        primary: 'bg-blue-100 text-blue-600',
        success: 'bg-green-100 text-green-700',
        info: 'bg-indigo-100 text-indigo-600',
        warning: 'bg-amber-100 text-amber-700',
    };
    return (
        <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                    {label}
                </span>
                <div
                    className={cn(
                        'flex size-10 items-center justify-center rounded-lg',
                        toneToIconClass[tone]
                    )}
                >
                    {icon}
                </div>
            </div>
            {loading ? (
                <span className="h-8 w-24 animate-pulse rounded bg-neutral-100" />
            ) : (
                <span className="text-3xl font-bold tracking-tight text-neutral-900">{value}</span>
            )}
            {sub && <span className="text-xs text-neutral-500">{sub}</span>}
        </div>
    );
}

// ── Daily dials vs connected (area-filled line chart) ──────────────────
// Same hand-rolled SVG idiom as the Overview tab's TrendChart — no chart libs.

function DailyCallsChart({ points }: { points: CallsDailyPoint[] }) {
    const { t } = useTranslation('audienceManagerCallingTab');
    const W = 700;
    const H = 180;
    const PAD = 32;
    const maxY = Math.max(1, ...points.map((p) => Math.max(p.dials, p.connected)));
    const stepX = (W - PAD * 2) / Math.max(1, points.length - 1);
    const yFor = (v: number) => H - PAD - (v / maxY) * (H - PAD * 2);
    const xFor = (i: number) => PAD + i * stepX;
    const line = (key: 'dials' | 'connected') =>
        points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(p[key])}`).join(' ');
    const area = (key: 'dials' | 'connected') =>
        `${line(key)} L ${xFor(points.length - 1)} ${H - PAD} L ${xFor(0)} ${H - PAD} Z`;
    const ticks = Array.from(
        new Set([0, Math.floor(points.length / 2), points.length - 1].filter((i) => i >= 0))
    );

    return (
        <div className="overflow-x-auto">
            <svg
                viewBox={`0 0 ${W} ${H}`}
                className="h-44 w-full"
                preserveAspectRatio="none"
                role="img"
                aria-label={t('dailyChart.ariaLabel')}
            >
                {/* gridlines */}
                <line
                    x1={PAD}
                    y1={H - PAD}
                    x2={W - PAD}
                    y2={H - PAD}
                    className="stroke-neutral-200"
                />
                <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} className="stroke-neutral-200" />
                {[0.25, 0.5, 0.75].map((f) => (
                    <line
                        key={f}
                        x1={PAD}
                        y1={PAD + f * (H - PAD * 2)}
                        x2={W - PAD}
                        y2={PAD + f * (H - PAD * 2)}
                        className="stroke-neutral-100"
                    />
                ))}
                {/* Area fills — translucent solids via Tailwind opacity modifier (no hex). */}
                <path d={area('dials')} className="fill-blue-500/20" />
                <path d={area('connected')} className="fill-green-600/20" />
                {/* Lines */}
                <path d={line('dials')} strokeWidth="2" fill="none" className="stroke-blue-500" />
                <path
                    d={line('connected')}
                    strokeWidth="2"
                    fill="none"
                    className="stroke-green-600"
                />
                {/* Points */}
                {points.map((p, i) => (
                    <g key={p.date}>
                        <circle cx={xFor(i)} cy={yFor(p.dials)} r={3} className="fill-blue-500" />
                        <circle
                            cx={xFor(i)}
                            cy={yFor(p.connected)}
                            r={3}
                            className="fill-green-600"
                        />
                    </g>
                ))}
                {/* X labels */}
                {ticks.map((i) => (
                    <text
                        key={i}
                        x={xFor(i)}
                        y={H - 10}
                        fontSize="10"
                        textAnchor="middle"
                        className="fill-neutral-400"
                    >
                        {points[i]?.date.slice(5)}
                    </text>
                ))}
                {/* Y bounds */}
                <text
                    x={PAD - 5}
                    y={PAD + 5}
                    fontSize="10"
                    textAnchor="end"
                    className="fill-neutral-400"
                >
                    {maxY}
                </text>
                <text
                    x={PAD - 5}
                    y={H - PAD}
                    fontSize="10"
                    textAnchor="end"
                    className="fill-neutral-400"
                >
                    0
                </text>
            </svg>
        </div>
    );
}

// ── Sortable per-counsellor table ──────────────────────────────────────

type SortKey =
    | 'name'
    | 'dials'
    | 'connected'
    | 'connect_rate'
    | 'talk_seconds'
    | 'avg_call_seconds';

function CounsellorCallsTable({ rows }: { rows: CallsByCounsellorRow[] }) {
    const { t } = useTranslation('audienceManagerCallingTab');
    const [sortKey, setSortKey] = useState<SortKey>('dials');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

    const sortedRows = useMemo(() => {
        const copy = [...rows];
        copy.sort((a, b) => {
            const av = a[sortKey];
            const bv = b[sortKey];
            // Nulls sink to the bottom regardless of direction.
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            if (typeof av === 'number' && typeof bv === 'number') {
                return sortDir === 'asc' ? av - bv : bv - av;
            }
            const s = String(av).localeCompare(String(bv));
            return sortDir === 'asc' ? s : -s;
        });
        return copy;
    }, [rows, sortKey, sortDir]);

    const toggleSort = (k: SortKey) => {
        if (sortKey === k) {
            setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortKey(k);
            setSortDir(k === 'name' ? 'asc' : 'desc');
        }
    };

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                        <SortableHeader
                            label={t('counsellorTable.headers.counsellor')}
                            sortKey="name"
                            current={sortKey}
                            dir={sortDir}
                            onClick={toggleSort}
                            align="left"
                        />
                        <SortableHeader
                            label={t('counsellorTable.headers.dials')}
                            sortKey="dials"
                            current={sortKey}
                            dir={sortDir}
                            onClick={toggleSort}
                        />
                        <SortableHeader
                            label={t('counsellorTable.headers.connected')}
                            sortKey="connected"
                            current={sortKey}
                            dir={sortDir}
                            onClick={toggleSort}
                        />
                        <SortableHeader
                            label={t('counsellorTable.headers.connectRate')}
                            sortKey="connect_rate"
                            current={sortKey}
                            dir={sortDir}
                            onClick={toggleSort}
                        />
                        <SortableHeader
                            label={t('counsellorTable.headers.talkTime')}
                            sortKey="talk_seconds"
                            current={sortKey}
                            dir={sortDir}
                            onClick={toggleSort}
                        />
                        <SortableHeader
                            label={t('counsellorTable.headers.avgCall')}
                            sortKey="avg_call_seconds"
                            current={sortKey}
                            dir={sortDir}
                            onClick={toggleSort}
                        />
                        <th className="py-2 pe-3 text-start">
                            {t('counsellorTable.headers.outcomes')}
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {sortedRows.map((r) => (
                        <tr
                            key={r.user_id}
                            className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                        >
                            <td className="py-2.5 pr-3 font-medium text-neutral-900">{r.name}</td>
                            <td className="py-2.5 pr-3 text-right text-neutral-800">{r.dials}</td>
                            <td className="py-2.5 pr-3 text-right text-neutral-800">
                                {r.connected}
                            </td>
                            <td
                                className={cn(
                                    'py-2.5 pr-3 text-right',
                                    connectRateClass(r.connect_rate)
                                )}
                            >
                                {fmtPct(r.connect_rate)}
                            </td>
                            <td className="py-2.5 pr-3 text-right text-neutral-800">
                                {fmtTalkHm(r.talk_seconds)}
                            </td>
                            <td className="py-2.5 pr-3 text-right text-neutral-800">
                                {fmtMinSec(r.avg_call_seconds)}
                            </td>
                            <td className="py-2.5 pr-3">
                                <OutcomeChips outcomes={r.outcomes} />
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function OutcomeChips({ outcomes }: { outcomes: Record<string, number> }) {
    const entries = Object.entries(outcomes ?? {})
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) return <span className="text-xs text-neutral-400">—</span>;
    return (
        <div className="flex max-w-xs flex-wrap gap-1">
            {entries.map(([status, n]) => (
                <span
                    key={status}
                    className={cn(
                        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
                        OUTCOME_CHIP_CLASSES[status] ?? OUTCOME_CHIP_FALLBACK
                    )}
                >
                    {humanizeCallStatus(status)}
                    <span className="font-semibold">{n}</span>
                </span>
            ))}
        </div>
    );
}

interface SortableHeaderProps {
    label: string;
    sortKey: SortKey;
    current: SortKey;
    dir: 'asc' | 'desc';
    onClick: (k: SortKey) => void;
    align?: 'left' | 'right';
}
function SortableHeader({
    label,
    sortKey,
    current,
    dir,
    onClick,
    align = 'right',
}: SortableHeaderProps) {
    const active = current === sortKey;
    return (
        <th
            className={cn(
                'cursor-pointer select-none py-2 pr-3 transition-colors hover:text-neutral-700',
                align === 'right' ? 'text-right' : 'text-left',
                active && 'text-neutral-700'
            )}
            onClick={() => onClick(sortKey)}
        >
            <span
                className={cn(
                    'inline-flex items-center gap-0.5',
                    align === 'right' && 'justify-end'
                )}
            >
                {label}
                {active && (dir === 'asc' ? <CaretUp size={10} /> : <CaretDown size={10} />)}
            </span>
        </th>
    );
}

// ── Hourly heatmap (7×24 CSS grid, no chart library) ───────────────────

/** dow 1 = Monday … 7 = Sunday (backend contract). */
const DOW_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** Intensity buckets relative to the busiest cell — static classes so Tailwind keeps them. */
function heatClass(dials: number, max: number): string {
    if (dials <= 0 || max <= 0) return 'bg-neutral-100';
    const f = dials / max;
    if (f <= 0.2) return 'bg-primary-100';
    if (f <= 0.4) return 'bg-primary-200';
    if (f <= 0.6) return 'bg-primary-300';
    if (f <= 0.8) return 'bg-primary-400';
    return 'bg-primary-500';
}

const HEAT_LEGEND_CLASSES = [
    'bg-neutral-100',
    'bg-primary-100',
    'bg-primary-200',
    'bg-primary-300',
    'bg-primary-400',
    'bg-primary-500',
] as const;

function CallsHeatmap({ cells }: { cells: CallsHeatmapCell[] }) {
    const { t } = useTranslation('audienceManagerCallingTab');
    const dowLabels = DOW_KEYS.map((k) => t(`heatmap.days.${k}`));
    const byKey = useMemo(() => {
        const m = new Map<string, CallsHeatmapCell>();
        for (const c of cells) m.set(`${c.dow}-${c.hour}`, c);
        return m;
    }, [cells]);
    const max = useMemo(() => cells.reduce((mx, c) => Math.max(mx, c.dials), 0), [cells]);

    return (
        <div className="flex flex-col gap-3">
            <div className="overflow-x-auto">
                {/* Single 25-column grid (day label + 24 hour cells) keeps the header row
                    and every day row column-aligned. Tailwind's static grid-cols scale
                    tops out at 12, so the 24-column template is set inline — a layout
                    template, not a color/spacing/type token. */}
                <div
                    className="grid gap-0.5"
                    style={{ gridTemplateColumns: 'auto repeat(24, minmax(18px, 1fr))' }}
                >
                    {/* Hour header row (label every 3 hours to avoid clutter) */}
                    <span aria-hidden="true" />
                    {HOURS.map((h) => (
                        <span key={`hh-${h}`} className="pb-1 text-center text-xs text-neutral-400">
                            {h % 3 === 0 ? h : ''}
                        </span>
                    ))}
                    {dowLabels.map((label, i) => {
                        const dow = i + 1; // 1 = Mon … 7 = Sun
                        return (
                            <Fragment key={dow}>
                                <span className="pr-2 text-xs leading-5 text-neutral-500">
                                    {label}
                                </span>
                                {HOURS.map((h) => {
                                    const cell = byKey.get(`${dow}-${h}`);
                                    const dials = cell?.dials ?? 0;
                                    const connected = cell?.connected ?? 0;
                                    const pct =
                                        dials > 0 ? Math.round((connected / dials) * 100) : null;
                                    const hourLabel = `${String(h).padStart(2, '0')}:00`;
                                    return (
                                        <div
                                            key={h}
                                            title={
                                                dials > 0
                                                    ? t('heatmap.tooltip.withDials', {
                                                          day: label,
                                                          hour: hourLabel,
                                                          count: dials,
                                                          pct,
                                                      })
                                                    : t('heatmap.tooltip.noDials', {
                                                          day: label,
                                                          hour: hourLabel,
                                                      })
                                            }
                                            className={cn('h-5 rounded-sm', heatClass(dials, max))}
                                        />
                                    );
                                })}
                            </Fragment>
                        );
                    })}
                </div>
            </div>
            {/* Intensity legend */}
            <div className="flex items-center justify-end gap-1 text-xs text-neutral-500">
                <span className="me-1">{t('heatmap.legendFewer')}</span>
                {HEAT_LEGEND_CLASSES.map((c) => (
                    <span key={c} className={cn('size-3 rounded-sm', c)} />
                ))}
                <span className="ms-1">{t('heatmap.legendMore')}</span>
            </div>
        </div>
    );
}
