import { useMemo, useState } from 'react';
import { ChartBar, ChartDonut, ChartLineUp, Funnel } from '@phosphor-icons/react';
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ComposedChart,
    LabelList,
    Line,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
    type TooltipProps,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { EngagementDailyReport } from '@/services/engagement-daily-report';
import {
    formatCredits,
    formatMoneyPartial,
    formatNumber,
    humanizeKey,
} from '../../-utils/report-format';
import { partFailed } from '../../-utils/report-errors';
import {
    buildFunnelSteps,
    deliveryPartial,
    emailRepliesUntracked,
} from '../../-utils/report-funnel';
import type { ReportCtx } from '../../-utils/report-tables';
import { ReportSection } from './ReportSection';

// Recharts takes SVG paint values, so tokens go in as hsl(var(--token)).
const PRIMARY = 'hsl(var(--primary-500))';
const PRIMARY_SOFT = 'hsl(var(--primary-200))';
const INFO = 'hsl(var(--info-500))';
const SUCCESS = 'hsl(var(--success-500))';
const WARNING = 'hsl(var(--warning-500))';
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

export function FunnelCard({ data, isLoading, onRetry }: ChartCardProps) {
    const { t } = useTranslation('engagementDailyReport');
    const stages = useMemo(
        () =>
            (data ? buildFunnelSteps(data, t) : []).map((s) => {
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
        [data, t]
    );
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
                        >
                            {stages.map((s) => (
                                <Cell
                                    key={s.stage}
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
            <div className="mt-2 flex flex-col gap-1 text-neutral-500">
                <p className="text-caption">{t('funnel.note')}</p>
                {deliveredPartial && <p className="text-caption">{t('funnel.deliveredNote')}</p>}
                {emailRepliesOff && <p className="text-caption">{t('email.repliesNote')}</p>}
            </div>
        </ReportSection>
    );
}

// ─── 7-day trend ────────────────────────────────────────────────────────────

type TrendKey = 'sent' | 'replies' | 'demosBooked' | 'credits';

const TREND_SERIES: Array<{ key: TrendKey; color: string; dot: string }> = [
    { key: 'sent', color: PRIMARY_SOFT, dot: 'bg-primary-200' },
    { key: 'replies', color: INFO, dot: 'bg-info-500' },
    { key: 'demosBooked', color: SUCCESS, dot: 'bg-success-500' },
    { key: 'credits', color: WARNING, dot: 'bg-warning-500' },
];

export function TrendCard({ data, isLoading, onRetry }: ChartCardProps) {
    const { t } = useTranslation('engagementDailyReport');
    const [hidden, setHidden] = useState<ReadonlySet<TrendKey>>(new Set());

    const points = useMemo(
        () =>
            (data?.trend ?? []).map((p) => ({
                date: p.date,
                label: dayLabel(p.date),
                sent: p.sent,
                replies: p.replies,
                demosBooked: p.demosBooked,
                credits: p.credits,
            })),
        [data]
    );

    const toggle = (key: TrendKey) =>
        setHidden((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });

    const renderTooltip = ({ active, payload, label }: TooltipProps<number, string>) => {
        if (!active || !payload?.length) return null;
        return (
            <TooltipBox>
                <p className="mb-1 text-caption font-semibold text-neutral-800">{label}</p>
                <div className="flex flex-col gap-0.5 text-caption text-neutral-600">
                    {payload.map((p) => {
                        const key = String(p.dataKey) as TrendKey;
                        const series = TREND_SERIES.find((s) => s.key === key);
                        return (
                            <span key={key} className="flex items-center gap-2">
                                <span className={cn('size-2 rounded-full', series?.dot)} />
                                {t(`trend.series.${key}`)}:{' '}
                                {key === 'credits' ? formatCredits(p.value) : formatNumber(p.value)}
                            </span>
                        );
                    })}
                </div>
            </TooltipBox>
        );
    };

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
            <div className="mb-3 flex flex-wrap gap-2">
                {TREND_SERIES.map((s) => {
                    const on = !hidden.has(s.key);
                    return (
                        <button
                            key={s.key}
                            type="button"
                            aria-pressed={on}
                            onClick={() => toggle(s.key)}
                            className={cn(
                                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                on
                                    ? 'border-neutral-300 bg-white text-neutral-800'
                                    : 'border-neutral-200 bg-neutral-50 text-neutral-400'
                            )}
                        >
                            <span className={cn('size-2 rounded-full', s.dot)} />
                            <span className="text-caption">
                                {s.key === 'credits'
                                    ? t('trend.seriesRight', { name: t(`trend.series.${s.key}`) })
                                    : t(`trend.series.${s.key}`)}
                            </span>
                        </button>
                    );
                })}
            </div>
            <div role="img" aria-label={t('trend.aria')} className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke={GRID} strokeDasharray="4 4" vertical={false} />
                        <XAxis
                            dataKey="label"
                            tick={AXIS_TICK}
                            tickLine={false}
                            axisLine={false}
                            minTickGap={16}
                            dy={6}
                        />
                        <YAxis
                            yAxisId="left"
                            tick={AXIS_TICK}
                            tickLine={false}
                            axisLine={false}
                            width={40}
                            allowDecimals={false}
                        />
                        <YAxis
                            yAxisId="right"
                            orientation="right"
                            hide={hidden.has('credits')}
                            tick={AXIS_TICK}
                            tickLine={false}
                            axisLine={false}
                            width={44}
                        />
                        <Tooltip cursor={{ fill: CURSOR }} content={renderTooltip} />
                        <Bar
                            yAxisId="left"
                            dataKey="sent"
                            fill={PRIMARY_SOFT}
                            radius={[4, 4, 0, 0]}
                            maxBarSize={28}
                            hide={hidden.has('sent')}
                            isAnimationActive={false}
                        />
                        <Line
                            yAxisId="left"
                            type="monotone"
                            dataKey="replies"
                            stroke={INFO}
                            strokeWidth={2}
                            dot={{ r: 3 }}
                            hide={hidden.has('replies')}
                            isAnimationActive={false}
                        />
                        <Line
                            yAxisId="left"
                            type="monotone"
                            dataKey="demosBooked"
                            stroke={SUCCESS}
                            strokeWidth={2}
                            dot={{ r: 3 }}
                            hide={hidden.has('demosBooked')}
                            isAnimationActive={false}
                        />
                        <Line
                            yAxisId="right"
                            type="monotone"
                            dataKey="credits"
                            stroke={WARNING}
                            strokeWidth={2}
                            strokeDasharray="5 4"
                            dot={{ r: 3 }}
                            hide={hidden.has('credits')}
                            isAnimationActive={false}
                        />
                    </ComposedChart>
                </ResponsiveContainer>
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
    const { t } = useTranslation('engagementDailyReport');
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
    const { t } = useTranslation('engagementDailyReport');
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
