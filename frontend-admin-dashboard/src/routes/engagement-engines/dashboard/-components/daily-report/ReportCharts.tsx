import { useMemo } from 'react';
import { ChartBar, ChartDonut, ChartLineUp, Funnel } from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    LabelList,
    Line,
    LineChart,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
    type TooltipProps,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import type { EngagementDailyReport } from '@/services/engagement-daily-report';
import {
    formatCredits,
    formatMoneyPartial,
    formatNumber,
    humanizeKey,
} from '../../-utils/report-format';
import { partFailed } from '../../-utils/report-errors';
import { sparseTicks, summarizeTrend, type TrendDay } from '../../-utils/report-trend';
import {
    buildFunnelSteps,
    deliveryPartial,
    emailRepliesUntracked,
} from '../../-utils/report-funnel';
import type { ReportCtx } from '../../-utils/report-tables';
import { useReportT } from './range-context';
import { ReportLink } from './ReportLink';
import { ReportSection } from './ReportSection';

// Recharts takes SVG paint values, so tokens go in as hsl(var(--token)).
const PRIMARY = 'hsl(var(--primary-500))';
const PRIMARY_SOFT = 'hsl(var(--primary-200))';
const INFO = 'hsl(var(--info-500))';
const INFO_SOFT = 'hsl(var(--info-200))';
const SUCCESS = 'hsl(var(--success-500))';
const SUCCESS_SOFT = 'hsl(var(--success-200))';
const WARNING = 'hsl(var(--warning-500))';
const WARNING_SOFT = 'hsl(var(--warning-200))';
const INK = 'hsl(var(--foreground))';
const MUTED = 'hsl(var(--muted-foreground))';
const GRID = 'hsl(var(--border))';
const CURSOR = 'hsl(var(--primary-50))';
const AXIS_TICK = { fill: MUTED, fontSize: 12 };

interface ChartCardProps {
    data: EngagementDailyReport | undefined;
    isLoading: boolean;
    onRetry: () => void;
}

function TooltipBox({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-w-36 rounded-lg border border-neutral-200 bg-popover px-3 py-2 shadow-lg">
            {children}
        </div>
    );
}

const dayLabel = (iso: string) => {
    const parsed = parseISO(iso);
    return Number.isNaN(parsed.getTime()) ? iso : format(parsed, 'dd MMM');
};

// ─── Funnel ─────────────────────────────────────────────────────────────────

export function FunnelCard({
    data,
    ctx,
    isLoading,
    onRetry,
}: ChartCardProps & { ctx: ReportCtx | undefined }) {
    const t = useReportT();
    const navigate = useNavigate();
    const links = ctx?.links;
    const stages = useMemo(
        () =>
            (data ? buildFunnelSteps(data, t, links) : []).map((s) => {
                const drop = s.dropOff;
                const sign = drop === null || drop === 0 ? '' : drop > 0 ? '−' : '+';
                // Delivered cannot be compared when some channels give no receipts, so it
                // says so instead of showing a drop-off.
                const caption = s.untracked
                    ? t('notTracked')
                    : s.partial
                      ? t('funnel.partialCaption', { value: formatNumber(s.count) })
                      : drop === null
                        ? formatNumber(s.count)
                        : `${formatNumber(s.count)} · ${sign}${Math.abs(drop)}%`;
                return { ...s, caption };
            }),
        [data, t, links]
    );
    const linked = stages.filter((s) => s.link);
    const deliveredPartial = !!data && deliveryPartial(data);
    const emailRepliesOff = !!data && emailRepliesUntracked(data);

    const renderTooltip = ({ active, payload }: TooltipProps<number, string>) => {
        const row = payload?.[0]?.payload as (typeof stages)[number] | undefined;
        if (!active || !row) return null;
        return (
            <TooltipBox>
                <p className="text-caption font-semibold text-neutral-800">{row.label}</p>
                <p className="text-caption text-neutral-600">
                    {row.untracked ? t('notTracked') : formatNumber(row.count)}
                </p>
                {(row.partial || row.untracked) && (
                    <p className="max-w-56 text-caption text-neutral-500">
                        {t('funnel.partialTooltip')}
                    </p>
                )}
                {row.dropOff !== null && (
                    <p className="text-caption text-neutral-500">
                        {row.dropOff >= 0
                            ? t('funnel.dropOff', { value: row.dropOff })
                            : t('funnel.rise', { value: Math.abs(row.dropOff) })}
                    </p>
                )}
            </TooltipBox>
        );
    };

    const isEmpty = stages.every((s) => s.count === 0);
    return (
        <ReportSection
            icon={Funnel}
            title={t('funnel.title')}
            subtitle={t('funnel.subtitle')}
            isLoading={isLoading}
            hasError={!!data && partFailed(data.errors, 'funnel')}
            isEmpty={isEmpty}
            onRetry={onRetry}
        >
            <div
                role="img"
                aria-label={t('funnel.aria', {
                    summary: stages.map((s) => `${s.label} ${s.count}`).join(', '),
                })}
                className="h-64 w-full"
            >
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                        data={stages}
                        layout="vertical"
                        margin={{ top: 4, right: 112, bottom: 4, left: 8 }}
                    >
                        <CartesianGrid horizontal={false} stroke={GRID} strokeDasharray="4 4" />
                        <XAxis type="number" hide domain={[0, 'dataMax']} />
                        <YAxis
                            type="category"
                            dataKey="label"
                            width={104}
                            tickLine={false}
                            axisLine={false}
                            tick={AXIS_TICK}
                        />
                        <Tooltip cursor={{ fill: CURSOR }} content={renderTooltip} />
                        <Bar
                            dataKey="count"
                            radius={[0, 4, 4, 0]}
                            barSize={24}
                            isAnimationActive={false}
                            // Clicking a bar is a shortcut; the links under the chart are the
                            // keyboard and screen-reader way to the same places.
                            onClick={(entry: { payload?: (typeof stages)[number] }) => {
                                const link = entry.payload?.link;
                                if (link) {
                                    navigate({
                                        to: link.to as never,
                                        search: link.search as never,
                                    });
                                }
                            }}
                        >
                            {stages.map((s) => (
                                <Cell
                                    key={s.stage}
                                    cursor={s.link ? 'pointer' : 'default'}
                                    fill={
                                        s.stage === 'CONVERTED'
                                            ? SUCCESS
                                            : s.partial || s.untracked
                                              ? PRIMARY_SOFT
                                              : PRIMARY
                                    }
                                />
                            ))}
                            <LabelList
                                dataKey="caption"
                                position="right"
                                fill={INK}
                                fontSize={12}
                            />
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
            {linked.length > 0 && (
                <nav
                    aria-label={t('funnel.linksLabel')}
                    className="mt-3 flex flex-wrap items-center gap-2"
                >
                    <span className="text-neutral-500">
                        <span className="text-caption">{t('funnel.linksLabel')}</span>
                    </span>
                    {linked.map(
                        (s) =>
                            s.link && (
                                <ReportLink
                                    key={s.stage}
                                    target={s.link}
                                    label={t('links.open', {
                                        value: formatNumber(s.count),
                                        what: s.label,
                                    })}
                                    className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-1 text-neutral-700 no-underline hover:border-primary-300"
                                >
                                    <span className="text-caption">{s.label}</span>
                                    <span className="font-semibold tabular-nums text-neutral-900">
                                        <span className="text-caption">
                                            {formatNumber(s.count)}
                                        </span>
                                    </span>
                                </ReportLink>
                            )
                    )}
                </nav>
            )}
            <div className="mt-2 flex flex-col gap-1 text-neutral-500">
                <p className="text-caption">{t('funnel.note')}</p>
                {deliveredPartial && <p className="text-caption">{t('funnel.deliveredNote')}</p>}
                {emailRepliesOff && <p className="text-caption">{t('email.repliesNote')}</p>}
            </div>
        </ReportSection>
    );
}

// ─── Day-by-day trend ───────────────────────────────────────────────────────

type TrendKey = 'sent' | 'replies' | 'demosBooked' | 'credits';

interface TrendSeries {
    key: TrendKey;
    /** The days of the period. */
    solid: string;
    soft: string;
    /** Counts are bars; credits, which are fractional and a running spend, are a line. */
    kind: 'bar' | 'line';
}

const TREND_SERIES: TrendSeries[] = [
    { key: 'sent', solid: PRIMARY, soft: PRIMARY_SOFT, kind: 'bar' },
    { key: 'replies', solid: INFO, soft: INFO_SOFT, kind: 'bar' },
    { key: 'demosBooked', solid: SUCCESS, soft: SUCCESS_SOFT, kind: 'bar' },
    { key: 'credits', solid: WARNING, soft: WARNING_SOFT, kind: 'line' },
];

/** 1200 is "1.2K": the small charts have little room for axis numbers. */
const compact = (n: number) =>
    new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

/** The scale starts at zero and is never flat, even when every day was zero. */
const scaleTop = (max: number) => (max > 0 ? max : 1);

/** Past this many days a line is drawn without a dot on every day. */
const MANY_DAYS = 31;

function MiniTrend({ series, days }: { series: TrendSeries; days: TrendDay[] }) {
    const t = useReportT();
    const show = series.key === 'credits' ? formatCredits : formatNumber;
    const name = t(`trend.series.${series.key}`);
    const summary = summarizeTrend(days);
    // Only a few days are named under the bars: a week of labels does not fit, nor does a quarter.
    const ticks = sparseTicks(days.map((d) => d.label));
    const inPeriod = days.filter((d) => d.selected).length;

    const renderTooltip = ({ active, payload }: TooltipProps<number, string>) => {
        const day = payload?.[0]?.payload as TrendDay | undefined;
        if (!active || !day) return null;
        return (
            <TooltipBox>
                <p className="text-caption font-semibold text-neutral-800">{day.label}</p>
                <p className="text-caption text-neutral-600">
                    {name}: {show(day.value)}
                </p>
            </TooltipBox>
        );
    };

    const axes = (
        <>
            <CartesianGrid stroke={GRID} strokeDasharray="4 4" vertical={false} />
            <XAxis
                dataKey="label"
                ticks={ticks}
                interval={0}
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                tickMargin={6}
            />
            <YAxis
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                width={32}
                tickCount={3}
                allowDecimals={series.key === 'credits'}
                tickFormatter={compact}
                domain={[0, scaleTop]}
            />
            <Tooltip cursor={{ fill: CURSOR }} content={renderTooltip} />
        </>
    );

    return (
        <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <div className="flex flex-col">
                <span className="truncate text-neutral-600">
                    <span className="text-caption">{name}</span>
                </span>
                <span className="font-bold tabular-nums text-neutral-900">
                    <span className="text-h2">{show(summary.headline)}</span>
                </span>
                <span className="truncate text-neutral-500">
                    <span className="text-caption">
                        {summary.note.kind === 'average'
                            ? t('trend.dailyAverage', { value: show(summary.note.value) })
                            : t('trend.weekTotal', { value: show(summary.note.value) })}
                    </span>
                </span>
            </div>
            <div
                role="img"
                aria-label={t('trend.miniAria', {
                    name,
                    days: days.map((d) => `${d.label} ${show(d.value)}`).join(', '),
                    total: show(summary.total),
                    average: show(summary.average),
                    numDays: inPeriod,
                })}
                className="h-28 w-full"
            >
                <ResponsiveContainer width="100%" height="100%">
                    {series.kind === 'bar' ? (
                        <BarChart data={days} margin={{ top: 4, right: 20, left: 0, bottom: 0 }}>
                            {axes}
                            <Bar dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                                {days.map((d) => (
                                    <Cell
                                        key={d.date}
                                        fill={d.selected ? series.solid : series.soft}
                                    />
                                ))}
                            </Bar>
                        </BarChart>
                    ) : (
                        <LineChart data={days} margin={{ top: 4, right: 20, left: 0, bottom: 0 }}>
                            {axes}
                            <Line
                                type="monotone"
                                dataKey="value"
                                // A period of several days is the line itself, in the solid colour.
                                stroke={inPeriod > 1 ? series.solid : series.soft}
                                strokeWidth={2}
                                isAnimationActive={false}
                                dot={
                                    days.length > MANY_DAYS
                                        ? false
                                        : ({ cx, cy, payload }) => (
                                              <circle
                                                  key={(payload as TrendDay).date}
                                                  cx={cx}
                                                  cy={cy}
                                                  r={(payload as TrendDay).selected ? 5 : 3}
                                                  fill={
                                                      (payload as TrendDay).selected
                                                          ? series.solid
                                                          : series.soft
                                                  }
                                              />
                                          )
                                }
                            />
                        </LineChart>
                    )}
                </ResponsiveContainer>
            </div>
        </div>
    );
}

/**
 * Four small charts, one bar per day, each on its own scale: a single chart for messages (tens
 * or hundreds) and credits (fractions) made one of them unreadable. For one day the chart shows
 * the week ending on it: the day is the big number and the solid bar or dot, the six before it
 * the soft ones. For a range the days of the period are solid and the big number is their total
 * (a period shorter than a week also shows the days before it, softly, for context).
 */
export function TrendCard({ data, isLoading, onRetry }: ChartCardProps) {
    const t = useReportT();

    const points = useMemo(() => data?.trend ?? [], [data]);
    const from = data?.from;
    const to = data?.to;
    const day = data?.date;
    const seriesDays = useMemo(
        () =>
            TREND_SERIES.map((series) => ({
                series,
                days: points.map(
                    (p): TrendDay => ({
                        date: p.date,
                        label: dayLabel(p.date),
                        value: p[series.key],
                        selected: from && to ? p.date >= from && p.date <= to : p.date === day,
                    })
                ),
            })),
        [points, from, to, day]
    );

    const isEmpty = points.every((p) => p.sent + p.replies + p.demosBooked + p.credits === 0);
    return (
        <ReportSection
            icon={ChartLineUp}
            title={t('trend.title')}
            subtitle={t('trend.subtitle')}
            isLoading={isLoading}
            hasError={!!data && partFailed(data.errors, 'trend')}
            isEmpty={isEmpty}
            emptyText={t('trend.empty')}
            onRetry={onRetry}
        >
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {seriesDays.map(({ series, days }) => (
                    <MiniTrend key={series.key} series={series} days={days} />
                ))}
            </div>
        </ReportSection>
    );
}

// ─── Sent vs replied, per channel ───────────────────────────────────────────

export function ChannelsCard({
    data,
    ctx,
    isLoading,
    onRetry,
}: ChartCardProps & { ctx: ReportCtx | undefined }) {
    const t = useReportT();
    const emailRepliesOff = data?.email?.repliesTracked === false;

    const rows = useMemo(
        () =>
            (data?.channels ?? []).map((c) => {
                // A reply count that is not tracked, or does not exist for the channel, would
                // read as "nobody replied", so no bar is drawn for it.
                const replies: 'tracked' | 'untracked' | 'none' =
                    c.channel === 'AI_CALL'
                        ? 'none'
                        : c.channel === 'IN_APP' || (c.channel === 'EMAIL' && emailRepliesOff)
                          ? 'untracked'
                          : 'tracked';
                return {
                    channel: c.channel,
                    label: ctx?.channelLabel(c.channel) ?? humanizeKey(c.channel),
                    sent: c.sent,
                    replied: replies === 'tracked' ? c.replied : null,
                    replies,
                };
            }),
        [data, ctx, emailRepliesOff]
    );

    const renderTooltip = ({ active, payload, label }: TooltipProps<number, string>) => {
        if (!active || !payload?.length) return null;
        const replies = (payload[0]?.payload as { replies?: string } | undefined)?.replies;
        return (
            <TooltipBox>
                <p className="mb-1 text-caption font-semibold text-neutral-800">{label}</p>
                <div className="flex flex-col gap-0.5 text-caption text-neutral-600">
                    {payload.map((p) => {
                        const isReplies = p.dataKey === 'replied';
                        // Nothing to say about replies to a call.
                        if (isReplies && replies === 'none') return null;
                        return (
                            <span key={String(p.dataKey)} className="flex items-center gap-2">
                                <span
                                    className={cn(
                                        'size-2 rounded-full',
                                        isReplies ? 'bg-success-500' : 'bg-info-500'
                                    )}
                                />
                                {t(`channelsChart.${String(p.dataKey)}`)}:{' '}
                                {isReplies && replies === 'untracked'
                                    ? t('notTracked')
                                    : formatNumber(p.value)}
                            </span>
                        );
                    })}
                </div>
            </TooltipBox>
        );
    };

    const hasInApp = rows.some((r) => r.channel === 'IN_APP' && r.sent > 0);
    const isEmpty = rows.every((r) => r.sent === 0 && !r.replied);
    return (
        <ReportSection
            icon={ChartBar}
            title={t('channelsChart.title')}
            subtitle={t('channelsChart.subtitle')}
            isLoading={isLoading}
            hasError={!!data && partFailed(data.errors, 'channels')}
            isEmpty={isEmpty}
            onRetry={onRetry}
        >
            <div className="mb-3 flex flex-wrap gap-4 text-neutral-600">
                <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-info-500" />
                    <span className="text-caption">{t('channelsChart.sent')}</span>
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-success-500" />
                    <span className="text-caption">{t('channelsChart.replied')}</span>
                </span>
            </div>
            <div role="img" aria-label={t('channelsChart.aria')} className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke={GRID} strokeDasharray="4 4" vertical={false} />
                        <XAxis
                            dataKey="label"
                            tick={AXIS_TICK}
                            tickLine={false}
                            axisLine={false}
                            dy={6}
                        />
                        <YAxis
                            tick={AXIS_TICK}
                            tickLine={false}
                            axisLine={false}
                            width={40}
                            allowDecimals={false}
                        />
                        {/* filterNull off: a null reply count still gets its "Not tracked" line. */}
                        <Tooltip
                            cursor={{ fill: CURSOR }}
                            content={renderTooltip}
                            filterNull={false}
                        />
                        <Bar
                            dataKey="sent"
                            fill={INFO}
                            radius={[4, 4, 0, 0]}
                            maxBarSize={32}
                            isAnimationActive={false}
                        />
                        <Bar
                            dataKey="replied"
                            fill={SUCCESS}
                            radius={[4, 4, 0, 0]}
                            maxBarSize={32}
                            isAnimationActive={false}
                        />
                    </BarChart>
                </ResponsiveContainer>
            </div>
            {(emailRepliesOff || hasInApp) && (
                <div className="mt-2 flex flex-col gap-1 text-neutral-500">
                    {emailRepliesOff && (
                        <p className="text-caption">{t('channelsChart.emailRepliesNote')}</p>
                    )}
                    {hasInApp && (
                        <p className="text-caption">{t('channelsChart.inAppRepliesNote')}</p>
                    )}
                </div>
            )}
        </ReportSection>
    );
}

// ─── Cost breakdown ─────────────────────────────────────────────────────────

const COST_SLICES = [
    { key: 'messages', fill: PRIMARY, dot: 'bg-primary-500' },
    { key: 'calls', fill: INFO, dot: 'bg-info-500' },
    { key: 'leadAgent', fill: SUCCESS, dot: 'bg-success-500' },
] as const;

export function CostBreakdownCard({ data, isLoading, onRetry }: ChartCardProps) {
    const t = useReportT();
    const credits = data?.costs?.credits;
    const whatsapp = data?.costs?.whatsapp;

    const slices = COST_SLICES.map((s) => ({ ...s, value: credits?.[s.key] ?? 0 })).filter(
        (s) => s.value > 0
    );
    const total = credits?.total ?? slices.reduce((sum, s) => sum + s.value, 0);
    // The WhatsApp charges have their own queries; when those failed there is nothing to say.
    const hasWhatsapp =
        !!whatsapp &&
        !!data &&
        !partFailed(data.errors, 'whatsappCost') &&
        (whatsapp.amount > 0 || whatsapp.billableMessages > 0);

    return (
        <ReportSection
            icon={ChartDonut}
            title={t('costChart.title')}
            subtitle={t('costChart.subtitle')}
            isLoading={isLoading}
            hasError={!!data && partFailed(data.errors, 'costChart')}
            isEmpty={slices.length === 0 && !hasWhatsapp}
            emptyText={t('costChart.empty')}
            onRetry={onRetry}
        >
            <div className="grid items-center gap-4 sm:grid-cols-2">
                <div
                    role="img"
                    aria-label={t('costChart.aria', { total: formatCredits(total) })}
                    className="relative h-48 w-full"
                >
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={slices}
                                dataKey="value"
                                nameKey="key"
                                innerRadius="62%"
                                outerRadius="88%"
                                paddingAngle={2}
                                stroke="none"
                                isAnimationActive={false}
                            >
                                {slices.map((s) => (
                                    <Cell key={s.key} fill={s.fill} />
                                ))}
                            </Pie>
                        </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                        <span className="font-semibold tabular-nums text-neutral-900">
                            <span className="text-h3">{formatCredits(total)}</span>
                        </span>
                        <span className="text-neutral-500">
                            <span className="text-caption">{t('costChart.centerLabel')}</span>
                        </span>
                    </div>
                </div>
                <ul className="flex flex-col gap-2">
                    {slices.map((s) => (
                        <li key={s.key} className="flex items-center justify-between gap-3">
                            <span className="flex items-center gap-2 text-neutral-700">
                                <span className={cn('size-2.5 rounded-full', s.dot)} />
                                <span className="text-body">{t(`costs.credits.${s.key}`)}</span>
                            </span>
                            <span className="tabular-nums text-neutral-900">
                                <span className="text-body">
                                    {formatCredits(s.value)}
                                    {total > 0 ? ` · ${Math.round((s.value / total) * 100)}%` : ''}
                                </span>
                            </span>
                        </li>
                    ))}
                </ul>
            </div>
            {hasWhatsapp && whatsapp && (
                <p className="mt-3 rounded-lg bg-neutral-50 p-3 text-neutral-600">
                    <span className="text-caption">
                        {t('costChart.whatsapp', {
                            amount: formatMoneyPartial(
                                whatsapp.amount,
                                whatsapp.currency,
                                whatsapp.partial,
                                t
                            ),
                            estimated: whatsapp.estimatedMessages > 0 ? t('estimatedSuffix') : '',
                        })}
                    </span>
                </p>
            )}
        </ReportSection>
    );
}
