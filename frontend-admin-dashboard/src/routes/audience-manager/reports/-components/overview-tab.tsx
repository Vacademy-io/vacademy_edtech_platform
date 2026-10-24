/**
 * Reports Center — Overview tab.
 *
 * The original Lead Reports page content (KPI cards · status donut · daily
 * trend · source/tier breakdowns), now scoped by the shell's shared filters
 * (date range + team + counsellor). The counsellor performance table moved
 * to its own Counsellors tab.
 *
 * Data: GET /v1/reports/leads/summary (read-only — purely visual aggregation).
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useLeadTiers } from '@/hooks/use-lead-tiers';
import { PerLeadExports } from './per-lead-exports';
import { useTranslation } from 'react-i18next';
import {
    CaretRight,
    ChartLineUp,
    CheckCircle,
    ClockCounterClockwise,
    Flame,
    Funnel,
    Megaphone,
    Users,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { fetchLeadReportSummary } from '../-services/get-lead-reports';
import {
    ALL_STATUSES_VALUE,
    CUSTOM_DATE_VALUE,
} from '../../recent-leads/-components/recent-leads-search';
import {
    BreakdownBar,
    BreakdownCard,
    EmptyHint,
    KpiCard,
    ReportErrorState,
    ReportTabSkeleton,
    fmtMinutes,
    fmtNumber,
    fmtPct,
    tierBgClass,
    type ReportTabProps,
} from './report-shared';

/** Where every drill-through on this tab lands. */
const RECENT_LEADS_ROUTE = '/audience-manager/recent-leads' as const;

export function OverviewTab({
    instituteId,
    fromDate,
    toDate,
    teamId,
    counsellorUserId,
    audienceId,
}: ReportTabProps) {
    const { t } = useTranslation('audienceManagerOverviewTab');
    const navigate = useNavigate();
    // Tier labels + colours from the institute catalog (custom tiers included).
    const tierCatalog = useLeadTiers();
    const tierLabels: Record<string, string> = useMemo(
        () => Object.fromEntries(tierCatalog.tiers.map((tier) => [tier.tier_key, tier.label])),
        [tierCatalog.tiers]
    );

    const summaryQuery = useQuery({
        queryKey: [
            'lead-report-summary',
            instituteId,
            fromDate,
            toDate,
            teamId,
            counsellorUserId,
            audienceId,
        ],
        queryFn: () =>
            fetchLeadReportSummary(
                instituteId,
                fromDate,
                toDate,
                teamId,
                counsellorUserId,
                audienceId
            ),
        enabled: !!instituteId,
        staleTime: 60_000,
        retry: false,
    });

    const summary = summaryQuery.data;
    const isLoading = summaryQuery.isLoading;

    if (isLoading) return <ReportTabSkeleton />;
    if (summaryQuery.isError) {
        return (
            <ReportErrorState error={summaryQuery.error} onRetry={() => summaryQuery.refetch()} />
        );
    }

    return (
        <div className="flex flex-col gap-6">
            {/* Per-lead TAT / SLA exports — only for institutes that turned them on. */}
            <PerLeadExports
                kinds={['tat', 'sla']}
                instituteId={instituteId}
                fromDate={fromDate}
                toDate={toDate}
                teamId={teamId}
                counsellorUserId={counsellorUserId}
                audienceId={audienceId}
            />
            {/* KPI cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard
                    label={t('kpi.totalLeads.label')}
                    value={fmtNumber(summary?.totals.total_leads)}
                    sub={
                        summary
                            ? t('kpi.totalLeads.sub', {
                                  active: summary.totals.active_leads,
                                  lost: summary.totals.lost_leads,
                              })
                            : undefined
                    }
                    icon={<Users size={20} weight="bold" />}
                    tone="primary"
                    loading={isLoading && !summary}
                    onClick={() =>
                        // Total = every status incl. Converted, so override the
                        // recent-leads default "Active leads" filter to match.
                        navigate({
                            to: RECENT_LEADS_ROUTE,
                            search: {
                                status: ALL_STATUSES_VALUE,
                                range: CUSTOM_DATE_VALUE,
                                // Empty inputs would fail the route's yyyy-MM-dd
                                // schema — omit them instead.
                                from: fromDate || undefined,
                                to: toDate || undefined,
                            },
                        })
                    }
                />
                <KpiCard
                    label={t('kpi.conversionRate.label')}
                    value={fmtPct(summary?.totals.conversion_rate)}
                    sub={
                        summary
                            ? t('kpi.conversionRate.sub', {
                                  converted: summary.totals.converted_leads,
                                  total: summary.totals.total_leads,
                              })
                            : undefined
                    }
                    icon={<CheckCircle size={20} weight="bold" />}
                    tone="success"
                    loading={isLoading && !summary}
                />
                <KpiCard
                    label={t('kpi.avgResponseTime.label')}
                    value={fmtMinutes(summary?.totals.avg_response_minutes)}
                    sub={
                        summary
                            ? t('kpi.avgResponseTime.sub', {
                                  count: summary.totals.responded_leads ?? 0,
                              })
                            : undefined
                    }
                    icon={<ClockCounterClockwise size={20} weight="bold" />}
                    tone="info"
                    loading={isLoading && !summary}
                />
                <KpiCard
                    label={t('kpi.tatMet.label')}
                    value={fmtPct(summary?.totals.tat_met_rate)}
                    sub={
                        summary?.totals.tat_met_count != null
                            ? t('kpi.tatMet.subCount', { count: summary.totals.tat_met_count })
                            : t('kpi.tatMet.subDisabled')
                    }
                    icon={<Funnel size={20} weight="bold" />}
                    tone={
                        summary?.totals.tat_met_rate == null
                            ? 'default'
                            : summary.totals.tat_met_rate >= 80
                              ? 'success'
                              : summary.totals.tat_met_rate >= 50
                                ? 'warning'
                                : 'danger'
                    }
                    loading={isLoading && !summary}
                />
            </div>

            {/* Status donut + Daily trend side by side; each card keeps its own height. */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start">
                <section className="flex min-w-0 flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center gap-2">
                        <Funnel size={18} className="text-neutral-500" />
                        <h2 className="text-base font-semibold text-neutral-900">
                            {t('status.title')}
                        </h2>
                    </div>
                    {summary && summary.by_status.length > 0 ? (
                        <StatusDonut
                            data={summary.by_status}
                            total={summary.totals.total_leads}
                            onSelectStatus={(statusKey) =>
                                navigate({
                                    to: RECENT_LEADS_ROUTE,
                                    search: { status: statusKey },
                                })
                            }
                        />
                    ) : (
                        <EmptyHint />
                    )}
                </section>

                <section className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm lg:col-span-2">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <ChartLineUp size={18} className="text-neutral-500" />
                            <h2 className="text-base font-semibold text-neutral-900">
                                {t('trend.title')}
                            </h2>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-neutral-600">
                            <span className="flex items-center gap-1">
                                <span className="size-2 rounded-full bg-blue-500" />{' '}
                                {t('trend.submittedLegend')}
                            </span>
                            <span className="flex items-center gap-1">
                                <span className="size-2 rounded-full bg-green-600" />{' '}
                                {t('trend.convertedLegend')}
                            </span>
                        </div>
                    </div>
                    {summary ? <TrendChart points={summary.trend_by_day} /> : <EmptyHint />}
                </section>
            </div>

            {/* Source + Tier breakdowns */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <BreakdownCard title={t('breakdown.bySource')} icon={<Megaphone size={16} />}>
                    {summary && summary.by_source.length > 0 ? (
                        summary.by_source.map((b) => (
                            <BreakdownBar
                                key={b.source_type}
                                label={b.source_type}
                                count={b.total}
                                total={summary.totals.total_leads}
                                converted={b.converted}
                                colorClass="bg-primary-500"
                                onClick={() =>
                                    navigate({
                                        to: RECENT_LEADS_ROUTE,
                                        search: { source: b.source_type },
                                    })
                                }
                            />
                        ))
                    ) : (
                        <EmptyHint />
                    )}
                </BreakdownCard>
                <BreakdownCard title={t('breakdown.byTier')} icon={<Flame size={16} />}>
                    {summary && summary.by_tier.length > 0 ? (
                        summary.by_tier.map((b) => (
                            <BreakdownBar
                                key={b.tier}
                                label={
                                    tierLabels[b.tier] ??
                                    b.tier.charAt(0) + b.tier.slice(1).toLowerCase()
                                }
                                count={b.count}
                                total={summary.totals.total_leads}
                                colorHex={tierCatalog.byKey(b.tier)?.color}
                                colorClass={tierBgClass(b.tier)}
                            />
                        ))
                    ) : (
                        <EmptyHint />
                    )}
                </BreakdownCard>
            </div>
        </div>
    );
}

// ── Status donut chart ─────────────────────────────────────────────────

interface StatusDonutProps {
    data: Array<{ status_key: string; label: string; color: string | null; count: number }>;
    total: number;
    /** Drill-through — legend rows navigate to the filtered Recent Leads list. */
    onSelectStatus?: (statusKey: string) => void;
}
/** Legend rows shown before "Show all": the biggest statuses. */
const LEGEND_COLLAPSED = 6;

function StatusDonut({ data, total, onSelectStatus }: StatusDonutProps) {
    const { t } = useTranslation('audienceManagerOverviewTab');
    const { t: tCrm } = useTranslation('crmDashboard');
    const [expanded, setExpanded] = useState(false);
    // Biggest first, so the collapsed legend shows what most leads are in.
    const legend = useMemo(() => [...data].sort((a, b) => b.count - a.count), [data]);
    const collapsible = legend.length > LEGEND_COLLAPSED;
    const shownLegend = collapsible && !expanded ? legend.slice(0, LEGEND_COLLAPSED) : legend;
    const SIZE = 180;
    const THICKNESS = 26;
    const RADIUS = (SIZE - THICKNESS) / 2;
    const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
    const CX = SIZE / 2;
    const CY = SIZE / 2;

    let offset = 0;
    const segments = data.map((d, i) => {
        const len = total > 0 ? (d.count / total) * CIRCUMFERENCE : 0;
        const seg = { ...d, dash: len, dashOffset: -offset, index: i };
        offset += len;
        return seg;
    });

    return (
        <div className="flex flex-col items-center gap-4">
            <div className="relative shrink-0">
                <svg
                    viewBox={`0 0 ${SIZE} ${SIZE}`}
                    className="size-44"
                    role="img"
                    aria-label={t('status.donutAriaLabel')}
                >
                    {/* Track */}
                    <circle
                        cx={CX}
                        cy={CY}
                        r={RADIUS}
                        fill="none"
                        strokeWidth={THICKNESS}
                        className="stroke-neutral-100"
                    />
                    {/* Segments */}
                    {segments.map((s) =>
                        s.color ? (
                            /* Per-institute catalog colour is data-driven; SVG stroke must be
                               a colour value, so this is the right place for the dynamic prop. */
                            <circle
                                key={s.status_key}
                                cx={CX}
                                cy={CY}
                                r={RADIUS}
                                fill="none"
                                stroke={s.color}
                                strokeWidth={THICKNESS}
                                strokeDasharray={`${s.dash} ${CIRCUMFERENCE - s.dash}`}
                                strokeDashoffset={s.dashOffset}
                                transform={`rotate(-90 ${CX} ${CY})`}
                            />
                        ) : (
                            <circle
                                key={s.status_key}
                                cx={CX}
                                cy={CY}
                                r={RADIUS}
                                fill="none"
                                strokeWidth={THICKNESS}
                                strokeDasharray={`${s.dash} ${CIRCUMFERENCE - s.dash}`}
                                strokeDashoffset={s.dashOffset}
                                transform={`rotate(-90 ${CX} ${CY})`}
                                className="stroke-primary-500"
                            />
                        )
                    )}
                </svg>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-bold text-neutral-900">{fmtNumber(total)}</span>
                    <span className="text-xs text-neutral-500">{t('status.totalUnit')}</span>
                </div>
            </div>
            <ul className="flex w-full min-w-0 flex-col gap-1">
                {shownLegend.map((d) => {
                    const pct = total > 0 ? (d.count / total) * 100 : 0;
                    return (
                        <li key={d.status_key}>
                            <button
                                type="button"
                                onClick={() => onSelectStatus?.(d.status_key)}
                                disabled={!onSelectStatus}
                                className={cn(
                                    'group flex w-full items-center justify-between gap-3 rounded-md px-1.5 py-1 text-left text-sm',
                                    onSelectStatus && 'cursor-pointer hover:bg-neutral-50'
                                )}
                            >
                                <div className="flex min-w-0 items-center gap-2">
                                    {/* Catalog colour from API — isolated dynamic style. */}
                                    <span
                                        className="size-3 shrink-0 rounded-sm"
                                        style={{ backgroundColor: d.color ?? undefined }}
                                    />
                                    <span className="truncate text-neutral-700">{d.label}</span>
                                </div>
                                <div className="flex items-baseline gap-2">
                                    <span className="font-medium text-neutral-900">{d.count}</span>
                                    <span className="text-xs text-neutral-500">
                                        {pct.toFixed(1)}%
                                    </span>
                                    {onSelectStatus && (
                                        <CaretRight
                                            size={12}
                                            className="self-center text-neutral-300 transition-colors group-hover:text-neutral-500"
                                        />
                                    )}
                                </div>
                            </button>
                        </li>
                    );
                })}
            </ul>
            {collapsible && (
                <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    className="self-start font-medium text-primary-600 hover:text-primary-700"
                >
                    <span className="text-caption">
                        {expanded
                            ? tCrm('pipeline.showLess')
                            : tCrm('pipeline.showAll', { count: legend.length })}
                    </span>
                </button>
            )}
        </div>
    );
}

// ── Daily trend (area-filled line chart) ───────────────────────────────

interface TrendChartProps {
    points: Array<{ date: string; submitted: number; converted: number }>;
}
function TrendChart({ points }: TrendChartProps) {
    const { t } = useTranslation('audienceManagerOverviewTab');
    if (points.length === 0) {
        return (
            <div className="flex h-40 items-center justify-center text-sm text-neutral-400">
                {t('trend.noData')}
            </div>
        );
    }
    const W = 700;
    const H = 180;
    const PAD = 32;
    const maxY = Math.max(1, ...points.map((p) => Math.max(p.submitted, p.converted)));
    const stepX = (W - PAD * 2) / Math.max(1, points.length - 1);
    const yFor = (v: number) => H - PAD - (v / maxY) * (H - PAD * 2);
    const xFor = (i: number) => PAD + i * stepX;
    const line = (key: 'submitted' | 'converted') =>
        points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(p[key])}`).join(' ');
    const area = (key: 'submitted' | 'converted') =>
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
                aria-label={t('trend.ariaLabel')}
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
                <path d={area('submitted')} className="fill-blue-500/20" />
                <path d={area('converted')} className="fill-green-600/20" />
                {/* Lines */}
                <path
                    d={line('submitted')}
                    strokeWidth="2"
                    fill="none"
                    className="stroke-blue-500"
                />
                <path
                    d={line('converted')}
                    strokeWidth="2"
                    fill="none"
                    className="stroke-green-600"
                />
                {/* Points */}
                {points.map((p, i) => (
                    <g key={p.date}>
                        <circle
                            cx={xFor(i)}
                            cy={yFor(p.submitted)}
                            r={3}
                            className="fill-blue-500"
                        />
                        <circle
                            cx={xFor(i)}
                            cy={yFor(p.converted)}
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
