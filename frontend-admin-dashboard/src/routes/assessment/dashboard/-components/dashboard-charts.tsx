import { useMemo, useState } from 'react';
import { CalendarDots, ChartBar, ChartDonut, Shapes, Target } from '@phosphor-icons/react';
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
    type TooltipProps,
} from 'recharts';
import { format, parse } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Tooltip as HoverTip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
    EmptyChart,
    SectionCard,
} from '@/routes/study-library/live-session/-components/dashboard/dashboard-charts';
import {
    formatCount,
    formatRate,
    rateTone,
} from '@/routes/study-library/live-session/-utils/dashboard-format';
import { heatLevel } from '@/routes/study-library/live-session/-utils/dashboard-insights';
import type {
    AssessmentDailyPoint,
    AssessmentDashboardSummary,
    AssessmentTypeSlice,
    ScoreBucket,
    SubmissionHeatCell,
} from '../-services/assessment-dashboard';
import { playModeKey } from '../-utils/assessment-dashboard-utils';

// Recharts takes SVG paint values, so tokens go in as hsl(var(--token)).
const INK_MUTED = 'hsl(var(--muted-foreground))';
const GRID = 'hsl(var(--border))';
const SURFACE = 'hsl(var(--card))';
const SERIES = 'hsl(var(--primary-500))';
const AXIS_TICK = { fill: INK_MUTED, fontSize: 12 };

const TONE_FILL = {
    success: 'hsl(var(--success-500))',
    warning: 'hsl(var(--warning-500))',
    danger: 'hsl(var(--danger-500))',
    neutral: 'hsl(var(--border))',
} as const;

function TooltipBox({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-w-36 rounded-lg border border-neutral-200 bg-popover px-3 py-2 shadow-lg">
            {children}
        </div>
    );
}

// ─── Daily trend ────────────────────────────────────────────────────────────

type TrendMetric = 'submissions' | 'score' | 'learners' | 'tests';
const TREND_METRICS: TrendMetric[] = ['submissions', 'score', 'learners', 'tests'];

/** One unit per view — the switch replaces a dual-axis chart. */
export function TrendCard({ daily }: { daily: AssessmentDailyPoint[] }) {
    const { t } = useTranslation('assessmentDashboard');
    const [metric, setMetric] = useState<TrendMetric>('submissions');

    const data = useMemo(
        () =>
            daily.map((d) => {
                const parsed = parse(d.date, 'yyyy-MM-dd', new Date());
                return {
                    label: Number.isNaN(parsed.getTime()) ? d.date : format(parsed, 'dd MMM'),
                    submissions: d.submissions,
                    score: d.avg_score,
                    learners: d.learners,
                    tests: d.assessments,
                };
            }),
        [daily]
    );

    const hasData = daily.some((d) => d.submissions > 0 || d.assessments > 0);
    const isLine = metric === 'score';

    const renderTooltip = ({ active, payload, label }: TooltipProps<number, string>) => {
        if (!active || !payload?.length) return null;
        const point = payload[0]?.payload as (typeof data)[number] | undefined;
        if (!point) return null;
        return (
            <TooltipBox>
                <p className="mb-1 text-caption font-semibold text-neutral-800">{label}</p>
                <p className="text-body font-semibold text-neutral-800">
                    {metric === 'score' ? formatRate(point.score) : formatCount(point[metric])}
                </p>
                <p className="text-caption text-neutral-500">{t(`trend.metrics.${metric}`)}</p>
            </TooltipBox>
        );
    };

    const axes = (
        <>
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
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                width={44}
                allowDecimals={false}
                domain={isLine ? [0, 1] : [0, 'auto']}
                tickFormatter={(v: number) => (isLine ? formatRate(v) : String(v))}
            />
            <Tooltip cursor={{ fill: 'hsl(var(--primary-50))' }} content={renderTooltip} />
        </>
    );

    return (
        <SectionCard
            icon={ChartBar}
            title={t('trend.title')}
            subtitle={t(`trend.subtitles.${metric}`)}
            className="xl:col-span-2"
            right={
                <Tabs value={metric} onValueChange={(v) => setMetric(v as TrendMetric)}>
                    <TabsList className="h-auto flex-wrap">
                        {TREND_METRICS.map((m) => (
                            <TabsTrigger key={m} value={m} className="text-caption">
                                {t(`trend.metrics.${m}`)}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>
            }
        >
            {!hasData ? (
                <EmptyChart className="h-72" text={t('empty.noActivity')} />
            ) : (
                <div className="h-72 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        {isLine ? (
                            <AreaChart
                                data={data}
                                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                            >
                                <defs>
                                    <linearGradient id="adTrendFill" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor={SERIES} stopOpacity={0.28} />
                                        <stop offset="100%" stopColor={SERIES} stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                {axes}
                                <Area
                                    isAnimationActive={false}
                                    type="monotone"
                                    dataKey="score"
                                    stroke={SERIES}
                                    strokeWidth={2.5}
                                    fill="url(#adTrendFill)"
                                    connectNulls
                                    dot={{ r: 3, fill: SERIES, stroke: SURFACE, strokeWidth: 2 }}
                                    activeDot={{
                                        r: 6,
                                        fill: SERIES,
                                        stroke: SURFACE,
                                        strokeWidth: 2,
                                    }}
                                />
                            </AreaChart>
                        ) : (
                            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                {axes}
                                <Bar
                                    isAnimationActive={false}
                                    dataKey={metric}
                                    fill={SERIES}
                                    radius={[4, 4, 0, 0]}
                                    maxBarSize={32}
                                />
                            </BarChart>
                        )}
                    </ResponsiveContainer>
                </div>
            )}
        </SectionCard>
    );
}

// ─── Participation (donut) ─────────────────────────────────────────────────

export function ParticipationDonut({ summary }: { summary: AssessmentDashboardSummary }) {
    const { t } = useTranslation('assessmentDashboard');
    const attempted = summary.attempted_learners;
    const missed = summary.not_attempted;
    const total = attempted + missed;
    const slices = [
        { key: 'attempted', value: attempted, color: TONE_FILL.success, dot: 'bg-success-500' },
        { key: 'notAttempted', value: missed, color: TONE_FILL.danger, dot: 'bg-danger-500' },
    ];

    return (
        <SectionCard
            icon={ChartDonut}
            title={t('donut.title')}
            subtitle={t('donut.subtitle', { count: summary.closed_assessments })}
        >
            {total === 0 ? (
                <EmptyChart text={t('kpis.noClosed')} />
            ) : (
                <div className="flex flex-1 flex-col items-center justify-between gap-5">
                    <div className="relative size-52">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    isAnimationActive={false}
                                    data={slices}
                                    dataKey="value"
                                    nameKey="key"
                                    innerRadius="72%"
                                    outerRadius="100%"
                                    stroke={SURFACE}
                                    strokeWidth={3}
                                    cornerRadius={4}
                                    paddingAngle={1}
                                    startAngle={90}
                                    endAngle={-270}
                                >
                                    {slices.map((s) => (
                                        <Cell key={s.key} fill={s.color} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    content={({ active, payload }) => {
                                        const p = payload?.[0];
                                        if (!active || !p) return null;
                                        const value = Number(p.value ?? 0);
                                        return (
                                            <TooltipBox>
                                                <p className="text-body font-semibold text-neutral-800">
                                                    {t(`donut.${String(p.name)}`)}
                                                </p>
                                                <p className="text-caption text-neutral-500">
                                                    {formatCount(value)} ·{' '}
                                                    {formatRate(value / total)}
                                                </p>
                                            </TooltipBox>
                                        );
                                    }}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-h1 font-semibold tabular-nums text-neutral-900">
                                {formatRate(summary.participation_rate)}
                            </span>
                            <span className="text-caption text-neutral-500">
                                {t('donut.center')}
                            </span>
                        </div>
                    </div>
                    <ul className="flex w-full flex-col divide-y divide-neutral-100">
                        {slices.map((s) => (
                            <li
                                key={s.key}
                                className="flex items-center justify-between gap-3 py-2 text-body"
                            >
                                <span className="flex min-w-0 items-center gap-2 text-neutral-700">
                                    <span
                                        className={cn('size-2.5 shrink-0 rounded-full', s.dot)}
                                        aria-hidden
                                    />
                                    <span className="truncate">{t(`donut.${s.key}`)}</span>
                                </span>
                                <span className="shrink-0 font-semibold tabular-nums text-neutral-800">
                                    {formatCount(s.value)}
                                    <span className="ml-1 text-caption font-regular text-neutral-400">
                                        {formatRate(s.value / total)}
                                    </span>
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </SectionCard>
    );
}

// ─── Score distribution ────────────────────────────────────────────────────

export function ScoreDistributionCard({
    buckets,
    summary,
}: {
    buckets: ScoreBucket[];
    summary: AssessmentDashboardSummary;
}) {
    const { t } = useTranslation('assessmentDashboard');
    const total = buckets.reduce((sum, b) => sum + b.count, 0);
    const data = buckets.map((b) => ({
        label: `${b.from}–${b.from + 10}`,
        count: b.count,
        // Colour by the band's midpoint on the same traffic light as everything else.
        fill: TONE_FILL[rateTone((b.from + 5) / 100)],
    }));

    return (
        <SectionCard
            icon={Target}
            title={t('scores.title')}
            subtitle={
                total > 0
                    ? t('scores.subtitle', {
                          n: formatCount(total),
                          avg: formatRate(summary.avg_score),
                      })
                    : undefined
            }
            className="xl:col-span-2"
        >
            {total === 0 ? (
                <EmptyChart className="h-64" text={t('kpis.noScores')} />
            ) : (
                <>
                    <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                <CartesianGrid
                                    stroke={GRID}
                                    strokeDasharray="4 4"
                                    vertical={false}
                                />
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
                                <Tooltip
                                    cursor={{ fill: 'hsl(var(--primary-50))' }}
                                    content={({ active, payload, label }) => {
                                        const p = payload?.[0];
                                        if (!active || !p) return null;
                                        const value = Number(p.value ?? 0);
                                        return (
                                            <TooltipBox>
                                                <p className="text-caption font-semibold text-neutral-800">
                                                    {t('scores.band', { band: label })}
                                                </p>
                                                <p className="text-body font-semibold text-neutral-800">
                                                    {t('scores.learners', {
                                                        n: formatCount(value),
                                                    })}
                                                </p>
                                                <p className="text-caption text-neutral-500">
                                                    {formatRate(value / total)}
                                                </p>
                                            </TooltipBox>
                                        );
                                    }}
                                />
                                <Bar
                                    isAnimationActive={false}
                                    dataKey="count"
                                    radius={[4, 4, 0, 0]}
                                    maxBarSize={44}
                                >
                                    {data.map((d) => (
                                        <Cell key={d.label} fill={d.fill} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-4 text-caption text-neutral-600">
                        <span className="flex items-center gap-2">
                            <span className="size-2.5 rounded-sm bg-danger-500" aria-hidden />
                            {t('scores.legend.low')}
                        </span>
                        <span className="flex items-center gap-2">
                            <span className="size-2.5 rounded-sm bg-warning-500" aria-hidden />
                            {t('scores.legend.mid')}
                        </span>
                        <span className="flex items-center gap-2">
                            <span className="size-2.5 rounded-sm bg-success-500" aria-hidden />
                            {t('scores.legend.high')}
                        </span>
                    </div>
                </>
            )}
        </SectionCard>
    );
}

// ─── Submission heatmap ────────────────────────────────────────────────────

const HEAT_BG = [
    'bg-neutral-100',
    'bg-primary-100',
    'bg-primary-200',
    'bg-primary-300',
    'bg-primary-400',
    'bg-primary-500',
] as const;

/** When learners hand in their tests (weekday × hour, in the admin's timezone). */
export function SubmissionHeatmap({ cells }: { cells: SubmissionHeatCell[] }) {
    const { t, i18n } = useTranslation('assessmentDashboard');
    const { hours, byKey, max } = useMemo(() => {
        const map = new Map<string, number>();
        let minHour = 24;
        let maxHour = -1;
        let peak = 0;
        for (const c of cells) {
            map.set(`${c.weekday}-${c.hour}`, c.submissions);
            minHour = Math.min(minHour, c.hour);
            maxHour = Math.max(maxHour, c.hour);
            peak = Math.max(peak, c.submissions);
        }
        const hs: number[] = [];
        for (let h = minHour; h <= maxHour; h++) hs.push(h);
        return { hours: hs, byKey: map, max: peak };
    }, [cells]);
    const weekdays = useMemo(() => {
        const fmt = new Intl.DateTimeFormat(i18n.language || 'en', { weekday: 'short' });
        // 5 Jan 2026 is a Monday.
        return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2026, 0, 5 + i)));
    }, [i18n.language]);
    const hourLabel = (h: number) => format(new Date(2026, 0, 5, h), 'h a');

    return (
        <SectionCard
            icon={CalendarDots}
            title={t('heatmap.title')}
            subtitle={t('heatmap.subtitle')}
            className="xl:col-span-2"
        >
            {hours.length === 0 ? (
                <EmptyChart text={t('empty.noSubmissions')} />
            ) : (
                <TooltipProvider delayDuration={100}>
                    <div className="overflow-x-auto">
                        <table className="w-full border-separate border-spacing-1">
                            <thead>
                                <tr>
                                    <th className="w-12" />
                                    {hours.map((h) => (
                                        <th
                                            key={h}
                                            className="whitespace-nowrap px-0.5 text-center text-caption font-regular text-neutral-500"
                                        >
                                            {hourLabel(h)}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {weekdays.map((day, wd) => (
                                    <tr key={day}>
                                        <th className="pr-2 text-left text-caption font-semibold text-neutral-600">
                                            {day}
                                        </th>
                                        {hours.map((h) => {
                                            const count = byKey.get(`${wd}-${h}`) ?? 0;
                                            const level = heatLevel(count, max);
                                            const box = (
                                                <div
                                                    className={cn(
                                                        'flex h-9 min-w-9 items-center justify-center rounded-md text-caption font-semibold tabular-nums transition-transform',
                                                        HEAT_BG[level],
                                                        level >= 4
                                                            ? 'text-white'
                                                            : 'text-neutral-700',
                                                        count > 0 && 'hover:scale-105'
                                                    )}
                                                >
                                                    {count > 0 ? count : ''}
                                                </div>
                                            );
                                            return (
                                                <td key={h} className="p-0">
                                                    {count > 0 ? (
                                                        <HoverTip>
                                                            <TooltipTrigger asChild>
                                                                {box}
                                                            </TooltipTrigger>
                                                            <TooltipContent>
                                                                <p className="font-semibold">
                                                                    {day} · {hourLabel(h)}
                                                                </p>
                                                                <p>
                                                                    {t('heatmap.cell', {
                                                                        n: count,
                                                                    })}
                                                                </p>
                                                            </TooltipContent>
                                                        </HoverTip>
                                                    ) : (
                                                        box
                                                    )}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="mt-3 flex items-center justify-end gap-1.5 text-caption text-neutral-500">
                        {t('heatmap.fewer')}
                        {HEAT_BG.slice(1).map((bg) => (
                            <span key={bg} className={cn('size-3 rounded-sm', bg)} aria-hidden />
                        ))}
                        {t('heatmap.more')}
                    </div>
                </TooltipProvider>
            )}
        </SectionCard>
    );
}

// ─── Test types ────────────────────────────────────────────────────────────

export function TypeCard({ types }: { types: AssessmentTypeSlice[] }) {
    const { t } = useTranslation('assessmentDashboard');
    const total = types.reduce((sum, s) => sum + s.assessments, 0);
    const max = Math.max(1, ...types.map((s) => s.assessments));
    return (
        <SectionCard icon={Shapes} title={t('types.title')} subtitle={t('types.subtitle')}>
            {total === 0 ? (
                <EmptyChart text={t('empty.noTests')} />
            ) : (
                <ul className="flex flex-col gap-3.5">
                    {types.map((s) => (
                        <li key={s.play_mode} className="flex flex-col gap-1.5">
                            <div className="flex items-center justify-between gap-3 text-body">
                                <span className="min-w-0 truncate text-neutral-700">
                                    {t(`playModes.${playModeKey(s.play_mode)}`)}
                                </span>
                                <span className="shrink-0 font-semibold tabular-nums text-neutral-800">
                                    {formatCount(s.assessments)}
                                    <span className="ml-1 text-caption font-regular text-neutral-400">
                                        {t('types.meta', {
                                            n: formatCount(s.submissions),
                                            avg: formatRate(s.avg_score),
                                        })}
                                    </span>
                                </span>
                            </div>
                            <Progress
                                value={(s.assessments / max) * 100}
                                className="h-2 !bg-neutral-100"
                                aria-hidden
                            />
                        </li>
                    ))}
                </ul>
            )}
        </SectionCard>
    );
}
