import { useMemo, useState } from 'react';
import type { Icon } from '@phosphor-icons/react';
import {
    Broadcast,
    CalendarDots,
    ChartBar,
    ChatsCircle,
    ChartDonut,
    Star,
} from '@phosphor-icons/react';
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
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Tooltip as HoverTip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type {
    DashboardClassRow,
    DashboardDailyPoint,
    DashboardPlatformSlice,
    DashboardRatingBucket,
    DashboardSummary,
} from '../../-services/live-class-dashboard';
import {
    formatCount,
    formatRate,
    formatRating,
    platformLabelKey,
} from '../../-utils/dashboard-format';
import { buildHeatmap, heatKey, heatLevel } from '../../-utils/dashboard-insights';
import { Stars } from './dashboard-kpis';

// Recharts takes SVG paint values, so tokens go in as hsl(var(--token)).
const INK_MUTED = 'hsl(var(--muted-foreground))';
const GRID = 'hsl(var(--border))';
const SURFACE = 'hsl(var(--card))';
const SERIES = 'hsl(var(--primary-500))';
const SERIES_SOFT = 'hsl(var(--primary-200))';
const AXIS_TICK = { fill: INK_MUTED, fontSize: 12 };

export function SectionCard({
    title,
    subtitle,
    icon: IconCmp,
    right,
    children,
    className,
}: {
    title: string;
    subtitle?: string;
    icon?: Icon;
    right?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <Card
            className={cn(
                'flex min-w-0 flex-col rounded-xl border-neutral-200 p-4 shadow-sm sm:p-5',
                className
            )}
        >
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                    {IconCmp && (
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600">
                            <IconCmp size={18} weight="duotone" />
                        </span>
                    )}
                    <div className="min-w-0">
                        <h3 className="text-subtitle font-semibold text-neutral-900">{title}</h3>
                        {subtitle && <p className="text-caption text-neutral-500">{subtitle}</p>}
                    </div>
                </div>
                {right}
            </div>
            {children}
        </Card>
    );
}

export function EmptyChart({ text, className }: { text: string; className?: string }) {
    return (
        <div
            className={cn(
                'flex h-48 items-center justify-center rounded-lg border border-dashed border-neutral-200 bg-neutral-50 px-4 text-center text-caption text-neutral-500',
                className
            )}
        >
            {text}
        </div>
    );
}

function TooltipBox({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-w-36 rounded-lg border border-neutral-200 bg-popover px-3 py-2 shadow-lg">
            {children}
        </div>
    );
}

// ─── Daily trend ────────────────────────────────────────────────────────────

type TrendMetric = 'attendance' | 'rate' | 'classes' | 'rating';
const TREND_METRICS: TrendMetric[] = ['attendance', 'rate', 'classes', 'rating'];

/**
 * One unit per view — the switch replaces a dual-axis chart. "attendance"
 * pairs expected and present learners, which share an axis.
 */
export function TrendCard({
    daily,
    classesTerm,
}: {
    daily: DashboardDailyPoint[];
    classesTerm: string;
}) {
    const { t } = useTranslation('studyLibraryLiveClassDashboard');
    const [metric, setMetric] = useState<TrendMetric>('attendance');

    const data = useMemo(
        () =>
            daily.map((d) => {
                const parsed = parse(d.date, 'yyyy-MM-dd', new Date());
                return {
                    label: Number.isNaN(parsed.getTime()) ? d.date : format(parsed, 'dd MMM'),
                    expected: d.expected,
                    present: d.present_in_audience,
                    rate: d.attendance_rate,
                    classes: d.classes,
                    rating: d.avg_rating,
                };
            }),
        [daily]
    );

    const hasData = daily.some((d) => d.classes > 0);
    const isLine = metric === 'rate' || metric === 'rating';

    const renderTooltip = ({ active, payload, label }: TooltipProps<number, string>) => {
        if (!active || !payload?.length) return null;
        const point = payload[0]?.payload as (typeof data)[number] | undefined;
        if (!point) return null;
        return (
            <TooltipBox>
                <p className="mb-1 text-caption font-semibold text-neutral-800">{label}</p>
                {metric === 'attendance' ? (
                    <div className="flex flex-col gap-0.5 text-caption text-neutral-600">
                        <span className="flex items-center gap-2">
                            <span className="size-2 rounded-full bg-primary-500" />
                            {t('trend.present')}: {formatCount(point.present)}
                        </span>
                        <span className="flex items-center gap-2">
                            <span className="size-2 rounded-full bg-primary-200" />
                            {t('trend.expected')}: {formatCount(point.expected)}
                        </span>
                        <span className="mt-1 font-semibold text-neutral-800">
                            {t('trend.rateLine', { rate: formatRate(point.rate) })}
                        </span>
                    </div>
                ) : (
                    <p className="text-body font-semibold text-neutral-800">
                        {metric === 'rate'
                            ? formatRate(point.rate)
                            : metric === 'rating'
                              ? formatRating(point.rating)
                              : formatCount(point.classes)}
                    </p>
                )}
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
                allowDecimals={metric === 'rating'}
                domain={metric === 'rate' ? [0, 1] : metric === 'rating' ? [0, 5] : [0, 'auto']}
                tickFormatter={(v: number) => (metric === 'rate' ? formatRate(v) : String(v))}
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
                                {t(`trend.metrics.${m}`, { term: classesTerm })}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>
            }
        >
            {!hasData ? (
                <EmptyChart
                    className="h-72"
                    text={t('empty.noClassesInRange', { term: classesTerm.toLowerCase() })}
                />
            ) : (
                <>
                    <div className="h-72 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            {isLine ? (
                                <AreaChart
                                    data={data}
                                    margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                                >
                                    <defs>
                                        <linearGradient
                                            id="lcdTrendFill"
                                            x1="0"
                                            y1="0"
                                            x2="0"
                                            y2="1"
                                        >
                                            <stop
                                                offset="0%"
                                                stopColor={SERIES}
                                                stopOpacity={0.28}
                                            />
                                            <stop
                                                offset="100%"
                                                stopColor={SERIES}
                                                stopOpacity={0}
                                            />
                                        </linearGradient>
                                    </defs>
                                    {axes}
                                    <Area
                                        isAnimationActive={false}
                                        type="monotone"
                                        dataKey={metric}
                                        stroke={SERIES}
                                        strokeWidth={2.5}
                                        fill="url(#lcdTrendFill)"
                                        connectNulls
                                        dot={{
                                            r: 3,
                                            fill: SERIES,
                                            stroke: SURFACE,
                                            strokeWidth: 2,
                                        }}
                                        activeDot={{
                                            r: 6,
                                            fill: SERIES,
                                            stroke: SURFACE,
                                            strokeWidth: 2,
                                        }}
                                    />
                                </AreaChart>
                            ) : (
                                <BarChart
                                    data={data}
                                    margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                                    barGap={2}
                                >
                                    {axes}
                                    {metric === 'attendance' ? (
                                        <>
                                            <Bar
                                                isAnimationActive={false}
                                                dataKey="expected"
                                                fill={SERIES_SOFT}
                                                radius={[4, 4, 0, 0]}
                                                maxBarSize={28}
                                            />
                                            <Bar
                                                isAnimationActive={false}
                                                dataKey="present"
                                                fill={SERIES}
                                                radius={[4, 4, 0, 0]}
                                                maxBarSize={28}
                                            />
                                        </>
                                    ) : (
                                        <Bar
                                            isAnimationActive={false}
                                            dataKey="classes"
                                            fill={SERIES}
                                            radius={[4, 4, 0, 0]}
                                            maxBarSize={32}
                                        />
                                    )}
                                </BarChart>
                            )}
                        </ResponsiveContainer>
                    </div>
                    {metric === 'attendance' && (
                        <div className="mt-3 flex flex-wrap items-center gap-4 text-caption text-neutral-600">
                            <span className="flex items-center gap-2">
                                <span className="size-2.5 rounded-sm bg-primary-200" aria-hidden />
                                {t('trend.expected')}
                            </span>
                            <span className="flex items-center gap-2">
                                <span className="size-2.5 rounded-sm bg-primary-500" aria-hidden />
                                {t('trend.present')}
                            </span>
                        </div>
                    )}
                </>
            )}
        </SectionCard>
    );
}

// ─── Attendance breakdown (donut) ──────────────────────────────────────────

export function AttendanceDonut({ summary }: { summary: DashboardSummary }) {
    const { t } = useTranslation('studyLibraryLiveClassDashboard');
    const present = summary.present_in_audience;
    const belowRule = Math.max(0, summary.joined_in_audience - summary.present_in_audience);
    const notJoined = Math.max(0, summary.expected_learners - summary.joined_in_audience);
    const total = present + belowRule + notJoined;

    const slices = [
        { key: 'present', value: present, color: 'hsl(var(--success-500))', dot: 'bg-success-500' },
        {
            key: 'belowRule',
            value: belowRule,
            color: 'hsl(var(--warning-500))',
            dot: 'bg-warning-500',
        },
        { key: 'notJoined', value: notJoined, color: 'hsl(var(--border))', dot: 'bg-neutral-200' },
    ];

    return (
        <SectionCard icon={ChartDonut} title={t('donut.title')} subtitle={t('donut.subtitle')}>
            {total === 0 ? (
                <EmptyChart text={t('kpis.noCompleted')} />
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
                                {formatRate(summary.attendance_rate)}
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
                    {summary.guests > 0 && (
                        <p className="w-full text-caption text-neutral-500">
                            {t('donut.guestsNote', { n: formatCount(summary.guests) })}
                        </p>
                    )}
                </div>
            )}
        </SectionCard>
    );
}

// ─── Schedule heatmap ──────────────────────────────────────────────────────

const HEAT_BG = [
    'bg-neutral-100',
    'bg-primary-100',
    'bg-primary-200',
    'bg-primary-300',
    'bg-primary-400',
    'bg-primary-500',
] as const;

/** When classes run (weekday × start hour) and how full those slots were. */
export function ScheduleHeatmap({
    classes,
    classesTerm,
}: {
    classes: DashboardClassRow[];
    classesTerm: string;
}) {
    const { t, i18n } = useTranslation('studyLibraryLiveClassDashboard');
    const heat = useMemo(() => buildHeatmap(classes), [classes]);
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
            subtitle={t('heatmap.subtitle', { term: classesTerm.toLowerCase() })}
            className="xl:col-span-2"
        >
            {heat.hours.length === 0 ? (
                <EmptyChart
                    text={t('empty.noClassesInRange', { term: classesTerm.toLowerCase() })}
                />
            ) : (
                <TooltipProvider delayDuration={100}>
                    <div className="overflow-x-auto">
                        <table className="w-full border-separate border-spacing-1">
                            <thead>
                                <tr>
                                    <th className="w-12" />
                                    {heat.hours.map((h) => (
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
                                        {heat.hours.map((h) => {
                                            const cell = heat.cells.get(heatKey(wd, h));
                                            const level = heatLevel(
                                                cell?.classes ?? 0,
                                                heat.maxClasses
                                            );
                                            const box = (
                                                <div
                                                    className={cn(
                                                        'flex h-9 min-w-9 items-center justify-center rounded-md text-caption font-semibold tabular-nums transition-transform',
                                                        HEAT_BG[level],
                                                        level >= 4
                                                            ? 'text-white'
                                                            : 'text-neutral-700',
                                                        cell && 'hover:scale-105'
                                                    )}
                                                >
                                                    {cell ? cell.classes : ''}
                                                </div>
                                            );
                                            return (
                                                <td key={h} className="p-0">
                                                    {cell ? (
                                                        <HoverTip>
                                                            <TooltipTrigger asChild>
                                                                {box}
                                                            </TooltipTrigger>
                                                            <TooltipContent>
                                                                <p className="font-semibold">
                                                                    {day} · {hourLabel(h)}
                                                                </p>
                                                                <p>
                                                                    {t('heatmap.cellClasses', {
                                                                        n: cell.classes,
                                                                        term: classesTerm.toLowerCase(),
                                                                    })}
                                                                </p>
                                                                {cell.expected > 0 && (
                                                                    <p>
                                                                        {t(
                                                                            'heatmap.cellAttendance',
                                                                            {
                                                                                rate: formatRate(
                                                                                    cell.present /
                                                                                        cell.expected
                                                                                ),
                                                                            }
                                                                        )}
                                                                    </p>
                                                                )}
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

// ─── Ranked bars (ratings, engagement, platforms) ───────────────────────────

interface RankedRow {
    key: string;
    label: React.ReactNode;
    value: number;
}

/**
 * Horizontal bars in one hue. Without `base` each row is a share of the rows'
 * total; with `base` each row is a rate of that base (e.g. attendees tracked),
 * so rows need not add up to 100%.
 */
function RankedBars({
    rows,
    emptyText,
    base,
}: {
    rows: RankedRow[];
    emptyText: string;
    base?: number;
}) {
    const total = base ?? rows.reduce((sum, r) => sum + r.value, 0);
    const max = base ?? Math.max(1, ...rows.map((r) => r.value));
    if (total === 0) return <EmptyChart text={emptyText} />;
    return (
        <ul className="flex flex-col gap-3.5">
            {rows.map((r) => (
                <li key={r.key} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-3 text-body">
                        <span className="min-w-0 truncate text-neutral-700">{r.label}</span>
                        <span className="shrink-0 font-semibold tabular-nums text-neutral-800">
                            {base !== undefined
                                ? formatRate(r.value / total)
                                : formatCount(r.value)}
                            <span className="ml-1 text-caption font-regular text-neutral-400">
                                {base !== undefined
                                    ? formatCount(r.value)
                                    : formatRate(r.value / total)}
                            </span>
                        </span>
                    </div>
                    <Progress
                        value={(r.value / max) * 100}
                        className="h-2 !bg-neutral-100"
                        aria-hidden
                    />
                </li>
            ))}
        </ul>
    );
}

export function RatingCard({
    distribution,
    summary,
}: {
    distribution: DashboardRatingBucket[];
    summary: DashboardSummary;
}) {
    const { t } = useTranslation('studyLibraryLiveClassDashboard');
    return (
        <SectionCard icon={Star} title={t('ratings.title')}>
            {summary.feedback_count > 0 && (
                <div className="mb-5 flex items-center gap-4 rounded-lg bg-warning-50 px-4 py-3">
                    <span className="text-h1 font-semibold tabular-nums text-neutral-900">
                        {formatRating(summary.avg_rating)}
                    </span>
                    <div className="flex flex-col gap-1">
                        <Stars rating={summary.avg_rating} size={16} />
                        <span className="text-caption text-neutral-600">
                            {t('ratings.subtitle', {
                                n: formatCount(summary.feedback_count),
                                rate: formatRate(summary.feedback_rate),
                            })}
                        </span>
                    </div>
                </div>
            )}
            <RankedBars
                rows={distribution.map((b) => ({
                    key: String(b.stars),
                    label: (
                        <span className="flex items-center gap-1">
                            {b.stars}
                            <Star size={12} weight="fill" className="text-warning-500" />
                        </span>
                    ),
                    value: b.count,
                }))}
                emptyText={t('kpis.noFeedback')}
            />
        </SectionCard>
    );
}

export function EngagementCard({ summary }: { summary: DashboardSummary }) {
    const { t } = useTranslation('studyLibraryLiveClassDashboard');
    // Share of tracked attendees who did each thing at least once — raw event
    // counts are not comparable (one learner can unmute a hundred times).
    const rows: RankedRow[] = [
        { key: 'talks', label: t('engagement.talks'), value: summary.spoke_count },
        { key: 'chats', label: t('engagement.chats'), value: summary.chatted_count },
        { key: 'raiseHands', label: t('engagement.raiseHands'), value: summary.raised_hand_count },
        { key: 'pollVotes', label: t('engagement.pollVotes'), value: summary.voted_count },
        { key: 'emojis', label: t('engagement.emojis'), value: summary.reacted_count },
    ];
    return (
        <SectionCard
            icon={ChatsCircle}
            title={t('engagement.title')}
            subtitle={
                summary.engagement_tracked > 0
                    ? t('engagement.subtitle', {
                          rate: formatRate(summary.engagement_rate),
                          n: formatCount(summary.engagement_tracked),
                      })
                    : undefined
            }
        >
            <RankedBars
                rows={rows}
                base={summary.engagement_tracked}
                emptyText={t('kpis.engagementNotTracked')}
            />
            {summary.engagement_tracked > 0 && (
                <p className="mt-5 border-t border-neutral-100 pt-3 text-caption text-neutral-500">
                    {t('engagement.totals', {
                        chats: formatCount(summary.chats),
                        hands: formatCount(summary.raise_hands),
                        votes: formatCount(summary.poll_votes),
                    })}
                </p>
            )}
        </SectionCard>
    );
}

export function PlatformCard({
    platforms,
    classesTerm,
}: {
    platforms: DashboardPlatformSlice[];
    classesTerm: string;
}) {
    const { t } = useTranslation('studyLibraryLiveClassDashboard');
    return (
        <SectionCard
            icon={Broadcast}
            title={t('platforms.title')}
            subtitle={t('platforms.subtitle', { term: classesTerm })}
        >
            <RankedBars
                rows={platforms.map((p) => ({
                    key: p.platform,
                    label: t(`platforms.names.${platformLabelKey(p.platform)}`),
                    value: p.classes,
                }))}
                emptyText={t('empty.noClassesInRange', { term: classesTerm.toLowerCase() })}
            />
        </SectionCard>
    );
}
