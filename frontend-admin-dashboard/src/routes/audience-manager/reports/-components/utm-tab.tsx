/**
 * Reports Center — Campaigns (UTM) tab.
 *
 * Answers the marketer's questions from the first-party campaign attribution
 * log (utm_attribution): how many PEOPLE each source / medium / campaign /
 * channel brought in over the window, how many of them are enrolled today,
 * what share of the window's leads carry any attribution at all, and the day
 * by day trend. Every breakdown row and campaign row drills through to Recent
 * Leads pre-filtered on that value, so a number is never a dead end.
 *
 * Data: GET /v1/utm/dashboard (services/utm-list-filters). Counts are of
 * distinct people, not touches — see the backend DTO for why.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
    CaretRight,
    ChartLineUp,
    GraduationCap,
    Link as LinkIcon,
    Megaphone,
    Tag,
    Target,
    UsersThree,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useUtmBuilderEnabled } from '@/hooks/use-utm-builder-enabled';
import {
    fetchUtmDashboard,
    utmDashboardQueryKey,
    type UtmDashboardBucket,
    type UtmDashboardCampaignRow,
    type UtmFilterDimension,
} from '@/services/utm-list-filters';
import { UTM_SEARCH_PARAM } from '../../recent-leads/-components/recent-leads-search';
import {
    BreakdownBar,
    BreakdownCard,
    EmptyHint,
    ExportWithColumnPickerButton,
    KpiCard,
    ReportErrorState,
    ReportSection,
    ReportTabSkeleton,
    SortableHeader,
    convRateClass,
    fmtNumber,
    fmtPct,
    type ReportTabProps,
} from './report-shared';

const RECENT_LEADS_ROUTE = '/audience-manager/recent-leads' as const;

/** Friendly labels for the capture surfaces (keys are API constants). */
const SOURCE_TYPE_LABEL_KEYS: Record<string, string> = {
    AUDIENCE: 'sourceTypes.audience',
    LIVE_SESSION: 'sourceTypes.liveSession',
    ASSESSMENT: 'sourceTypes.assessment',
    ENROLL_INVITE: 'sourceTypes.enrollInvite',
    PRODUCT_PAGE: 'sourceTypes.productPage',
    CATALOGUE: 'sourceTypes.catalogue',
    CUSTOM: 'sourceTypes.custom',
};

type SortKey = 'utm_campaign' | 'utm_source' | 'utm_medium' | 'people' | 'enrolled' | 'rate';

export function UtmTab({ instituteId, fromDate, toDate }: ReportTabProps) {
    const { t } = useTranslation('audienceManagerUtmTab');
    const { t: tUtm } = useTranslation('utmListFilters');
    const navigate = useNavigate();
    const utm = useUtmBuilderEnabled();
    const params = { instituteId, fromDate, toDate };

    const query = useQuery({
        queryKey: utmDashboardQueryKey(params),
        queryFn: () => fetchUtmDashboard(params),
        enabled: !!instituteId && utm.enabled,
        staleTime: 60_000,
        retry: false,
    });

    const [sortKey, setSortKey] = useState<SortKey>('people');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

    const rate = (r: { people: number; enrolled: number }) =>
        r.people > 0 ? (r.enrolled / r.people) * 100 : null;

    const rows = useMemo(() => {
        const list = [...(query.data?.campaigns ?? [])];
        const valueOf = (r: UtmDashboardCampaignRow): string | number | null =>
            sortKey === 'rate' ? rate(r) : r[sortKey];
        list.sort((a, b) => {
            const av = valueOf(a);
            const bv = valueOf(b);
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            if (typeof av === 'number' && typeof bv === 'number') {
                return sortDir === 'asc' ? av - bv : bv - av;
            }
            const s = String(av).localeCompare(String(bv));
            return sortDir === 'asc' ? s : -s;
        });
        return list;
    }, [query.data, sortKey, sortDir]);

    const toggleSort = (k: SortKey) => {
        if (sortKey === k) {
            setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortKey(k);
            setSortDir(
                k === 'utm_campaign' || k === 'utm_source' || k === 'utm_medium' ? 'asc' : 'desc'
            );
        }
    };

    /** Drill through to Recent Leads filtered on one dimension value. */
    const openLeads = (dimension: UtmFilterDimension, value: string | null) => {
        if (!value) return;
        void navigate({
            to: RECENT_LEADS_ROUTE,
            search: { [UTM_SEARCH_PARAM[dimension]]: value, range: 'ALL' } as never,
        });
    };

    const openCampaignRow = (r: UtmDashboardCampaignRow) => {
        void navigate({
            to: RECENT_LEADS_ROUTE,
            search: {
                utmCampaign: r.utm_campaign ?? undefined,
                utmSource: r.utm_source ?? undefined,
                utmMedium: r.utm_medium ?? undefined,
                utmChannel: r.source_type ?? undefined,
                range: 'ALL',
            } as never,
        });
    };

    const sourceTypeLabel = (key: string | null) =>
        key
            ? tUtm(SOURCE_TYPE_LABEL_KEYS[key] ?? 'sourceTypes.custom', { defaultValue: key })
            : null;

    // ── Gates ──────────────────────────────────────────────────────────
    if (!utm.isResolved) return <ReportTabSkeleton />;
    if (!utm.enabled) {
        return (
            <ReportSection title={t('title')} icon={<Megaphone size={18} />}>
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                    <LinkIcon size={32} className="text-neutral-300" />
                    <p className="max-w-md text-sm text-neutral-600">{t('disabled.body')}</p>
                    <button
                        type="button"
                        onClick={() =>
                            navigate({
                                to: '/settings',
                                search: { selectedTab: 'utmSettings' },
                            })
                        }
                        className="text-sm font-medium text-primary-500 hover:underline"
                    >
                        {t('disabled.cta')}
                    </button>
                </div>
            </ReportSection>
        );
    }
    if (query.isLoading) return <ReportTabSkeleton />;
    if (query.isError) {
        return <ReportErrorState error={query.error} onRetry={() => query.refetch()} />;
    }

    const data = query.data;
    const totals = data?.totals;
    const noData = !totals || totals.touches === 0;
    const topCampaign = data?.by_campaign.find((b) => b.key !== null) ?? null;
    const coverage =
        totals && totals.leads_in_window > 0
            ? (totals.attributed_leads_in_window / totals.leads_in_window) * 100
            : null;
    const enrolRate = totals && totals.people > 0 ? (totals.enrolled / totals.people) * 100 : null;

    const breakdown = (
        title: string,
        icon: React.ReactNode,
        buckets: UtmDashboardBucket[] | undefined,
        dimension: UtmFilterDimension,
        labelFor: (key: string | null) => string | null = (k) => k
    ) => {
        const list = (buckets ?? []).filter((b) => b.key !== null).slice(0, 8);
        const total = Math.max(1, ...list.map((b) => b.people));
        return (
            <BreakdownCard title={title} icon={icon}>
                {list.length === 0 ? (
                    <EmptyHint message={t('breakdown.empty')} />
                ) : (
                    list.map((b) => (
                        <BreakdownBar
                            key={b.key ?? '__none__'}
                            label={labelFor(b.key) ?? t('breakdown.none')}
                            count={b.people}
                            total={total}
                            converted={b.enrolled}
                            onClick={() => openLeads(dimension, b.key)}
                        />
                    ))
                )}
            </BreakdownCard>
        );
    };

    return (
        <div className="flex flex-col gap-6">
            {/* KPI strip */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
                <KpiCard
                    label={t('kpis.people.label')}
                    value={fmtNumber(totals?.people ?? 0)}
                    sub={t('kpis.people.sub', { touches: fmtNumber(totals?.touches ?? 0) })}
                    icon={<UsersThree size={20} />}
                    tone="primary"
                />
                <KpiCard
                    label={t('kpis.enrolled.label')}
                    value={fmtNumber(totals?.enrolled ?? 0)}
                    sub={
                        enrolRate == null
                            ? t('kpis.enrolled.subNone')
                            : t('kpis.enrolled.sub', { rate: fmtPct(enrolRate) })
                    }
                    icon={<GraduationCap size={20} />}
                    tone="success"
                />
                <KpiCard
                    label={t('kpis.campaigns.label')}
                    value={fmtNumber(totals?.distinct_campaigns ?? 0)}
                    sub={t('kpis.campaigns.sub', {
                        sources: fmtNumber(totals?.distinct_sources ?? 0),
                    })}
                    icon={<Megaphone size={20} />}
                    tone="info"
                />
                <KpiCard
                    label={t('kpis.coverage.label')}
                    value={coverage == null ? '—' : fmtPct(coverage)}
                    sub={t('kpis.coverage.sub', {
                        attributed: fmtNumber(totals?.attributed_leads_in_window ?? 0),
                        total: fmtNumber(totals?.leads_in_window ?? 0),
                    })}
                    icon={<Target size={20} />}
                    tone={coverage != null && coverage < 25 ? 'warning' : 'default'}
                />
                <KpiCard
                    label={t('kpis.topCampaign.label')}
                    value={topCampaign?.key ?? '—'}
                    sub={
                        topCampaign
                            ? t('kpis.topCampaign.sub', { people: fmtNumber(topCampaign.people) })
                            : t('kpis.topCampaign.subNone')
                    }
                    icon={<Tag size={20} />}
                    onClick={topCampaign ? () => openLeads('campaign', topCampaign.key) : undefined}
                />
            </div>

            {noData ? (
                <ReportSection title={t('title')} icon={<Megaphone size={18} />}>
                    <div className="flex flex-col items-center gap-2 py-10 text-center">
                        <Megaphone size={32} className="text-neutral-300" />
                        <p className="text-sm font-medium text-neutral-700">{t('empty.title')}</p>
                        <p className="max-w-lg text-sm text-neutral-500">{t('empty.body')}</p>
                    </div>
                </ReportSection>
            ) : (
                <>
                    {/* Trend */}
                    <ReportSection title={t('trend.title')} icon={<ChartLineUp size={18} />}>
                        <div className="flex items-center gap-4 text-xs text-neutral-500">
                            <span className="flex items-center gap-1.5">
                                <span className="inline-block size-2.5 rounded-full bg-blue-500" />
                                {t('trend.peopleLegend')}
                            </span>
                            <span className="flex items-center gap-1.5">
                                <span className="inline-block size-2.5 rounded-full bg-neutral-300" />
                                {t('trend.touchesLegend')}
                            </span>
                        </div>
                        <TrendChart points={data?.trend ?? []} />
                    </ReportSection>

                    {/* Breakdowns */}
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {breakdown(
                            tUtm('dimensions.source'),
                            <Megaphone size={16} />,
                            data?.by_source,
                            'source'
                        )}
                        {breakdown(
                            tUtm('dimensions.medium'),
                            <LinkIcon size={16} />,
                            data?.by_medium,
                            'medium'
                        )}
                        {breakdown(
                            tUtm('dimensions.campaign'),
                            <Tag size={16} />,
                            data?.by_campaign,
                            'campaign'
                        )}
                        {breakdown(
                            tUtm('dimensions.sourceType'),
                            <Target size={16} />,
                            data?.by_source_type,
                            'source_type',
                            sourceTypeLabel
                        )}
                        {(data?.by_content ?? []).some((b) => b.key) &&
                            breakdown(
                                tUtm('dimensions.content'),
                                <Tag size={16} />,
                                data?.by_content,
                                'content'
                            )}
                        {(data?.by_term ?? []).some((b) => b.key) &&
                            breakdown(
                                tUtm('dimensions.term'),
                                <Tag size={16} />,
                                data?.by_term,
                                'term'
                            )}
                    </div>

                    {/* Campaign matrix */}
                    <ReportSection
                        title={t('table.title')}
                        icon={<Tag size={18} />}
                        actions={
                            <ExportWithColumnPickerButton
                                filename={`utm-campaigns_${fromDate}_${toDate}.csv`}
                                disabled={rows.length === 0}
                                getHeadersAndRows={() => ({
                                    headers: [
                                        t('table.columns.campaign'),
                                        t('table.columns.source'),
                                        t('table.columns.medium'),
                                        t('table.columns.channel'),
                                        t('table.columns.people'),
                                        t('table.columns.touches'),
                                        t('table.columns.enrolled'),
                                        t('table.columns.rate'),
                                        t('table.columns.firstSeen'),
                                        t('table.columns.lastSeen'),
                                    ],
                                    rows: rows.map((r) => [
                                        r.utm_campaign ?? '',
                                        r.utm_source ?? '',
                                        r.utm_medium ?? '',
                                        sourceTypeLabel(r.source_type) ?? '',
                                        r.people,
                                        r.touches,
                                        r.enrolled,
                                        rate(r),
                                        r.first_seen ?? '',
                                        r.last_seen ?? '',
                                    ]),
                                })}
                            />
                        }
                    >
                        {rows.length === 0 ? (
                            <EmptyHint message={t('table.empty')} />
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                                            <SortableHeader
                                                label={t('table.columns.campaign')}
                                                sortKey="utm_campaign"
                                                current={sortKey}
                                                dir={sortDir}
                                                onClick={toggleSort}
                                                align="left"
                                            />
                                            <SortableHeader
                                                label={t('table.columns.source')}
                                                sortKey="utm_source"
                                                current={sortKey}
                                                dir={sortDir}
                                                onClick={toggleSort}
                                                align="left"
                                            />
                                            <SortableHeader
                                                label={t('table.columns.medium')}
                                                sortKey="utm_medium"
                                                current={sortKey}
                                                dir={sortDir}
                                                onClick={toggleSort}
                                                align="left"
                                            />
                                            <th className="py-2 pr-3 text-left">
                                                {t('table.columns.channel')}
                                            </th>
                                            <SortableHeader
                                                label={t('table.columns.people')}
                                                sortKey="people"
                                                current={sortKey}
                                                dir={sortDir}
                                                onClick={toggleSort}
                                            />
                                            <SortableHeader
                                                label={t('table.columns.enrolled')}
                                                sortKey="enrolled"
                                                current={sortKey}
                                                dir={sortDir}
                                                onClick={toggleSort}
                                            />
                                            <SortableHeader
                                                label={t('table.columns.rate')}
                                                sortKey="rate"
                                                current={sortKey}
                                                dir={sortDir}
                                                onClick={toggleSort}
                                            />
                                            <th className="py-2 pr-3 text-right">
                                                {t('table.columns.lastSeen')}
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((r, i) => (
                                            <tr
                                                key={`${r.utm_campaign}|${r.utm_source}|${r.utm_medium}|${r.source_type}|${i}`}
                                                className="group cursor-pointer border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                                                onClick={() => openCampaignRow(r)}
                                            >
                                                <td className="py-2.5 pr-3">
                                                    <span className="flex items-center gap-1 font-medium text-neutral-900">
                                                        {r.utm_campaign ?? (
                                                            <span className="italic text-neutral-400">
                                                                {t('table.noValue')}
                                                            </span>
                                                        )}
                                                        <CaretRight
                                                            size={12}
                                                            className="text-neutral-300 transition-colors group-hover:text-neutral-500"
                                                        />
                                                    </span>
                                                </td>
                                                <td className="py-2.5 pr-3 text-neutral-800">
                                                    {r.utm_source ?? '—'}
                                                </td>
                                                <td className="py-2.5 pr-3 text-neutral-800">
                                                    {r.utm_medium ?? '—'}
                                                </td>
                                                <td className="py-2.5 pr-3 text-neutral-600">
                                                    {sourceTypeLabel(r.source_type) ?? '—'}
                                                </td>
                                                <td className="py-2.5 pr-3 text-right text-neutral-800">
                                                    {fmtNumber(r.people)}
                                                    {r.touches !== r.people && (
                                                        <span className="ml-1 text-xs text-neutral-400">
                                                            {t('table.touchesInline', {
                                                                touches: fmtNumber(r.touches),
                                                            })}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="py-2.5 pr-3 text-right font-medium text-green-700">
                                                    {fmtNumber(r.enrolled)}
                                                </td>
                                                <td
                                                    className={cn(
                                                        'py-2.5 pr-3 text-right',
                                                        convRateClass(rate(r))
                                                    )}
                                                >
                                                    {fmtPct(rate(r))}
                                                </td>
                                                <td className="py-2.5 pr-3 text-right text-xs text-neutral-500">
                                                    {r.last_seen ? formatDate(r.last_seen) : '—'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </ReportSection>
                </>
            )}
        </div>
    );
}

const formatDate = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
};

// ── Daily trend (bars for touches, line for people) ────────────────────

function TrendChart({
    points,
}: {
    points: Array<{ date: string; touches: number; people: number }>;
}) {
    const { t } = useTranslation('audienceManagerUtmTab');
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
    const maxY = Math.max(1, ...points.map((p) => Math.max(p.touches, p.people)));
    const innerW = W - PAD * 2;
    const slot = innerW / Math.max(1, points.length);
    const barW = Math.max(2, Math.min(18, slot * 0.6));
    const yFor = (v: number) => H - PAD - (v / maxY) * (H - PAD * 2);
    const xFor = (i: number) => PAD + i * slot + slot / 2;
    const line = points
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(p.people)}`)
        .join(' ');
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
                {points.map((p, i) => (
                    <rect
                        key={p.date}
                        x={xFor(i) - barW / 2}
                        y={yFor(p.touches)}
                        width={barW}
                        height={Math.max(0, H - PAD - yFor(p.touches))}
                        className="fill-neutral-200"
                    />
                ))}
                <path d={line} strokeWidth="2" fill="none" className="stroke-blue-500" />
                {points.map((p, i) =>
                    p.people > 0 ? (
                        <circle
                            key={p.date}
                            cx={xFor(i)}
                            cy={yFor(p.people)}
                            r={3}
                            className="fill-blue-500"
                        />
                    ) : null
                )}
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
