import type { Icon } from '@phosphor-icons/react';
import {
    ArrowDownRight,
    ArrowRight,
    ArrowUpRight,
    ChatsCircle,
    Clock,
    Star,
    UserCheck,
    UsersThree,
    VideoCamera,
} from '@phosphor-icons/react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { DashboardDailyPoint, DashboardSummary } from '../../-services/live-class-dashboard';
import {
    formatCount,
    formatDuration,
    formatRate,
    formatRating,
} from '../../-utils/dashboard-format';
import {
    computeDelta,
    formatDeltaValue,
    type Delta,
    type DeltaKind,
} from '../../-utils/dashboard-insights';

type Tint = 'primary' | 'info' | 'success' | 'warning';

const ICON_TINT: Record<Tint, string> = {
    primary: 'bg-primary-50 text-primary-500 ring-primary-100',
    info: 'bg-info-50 text-info-600 ring-info-100',
    success: 'bg-success-50 text-success-600 ring-success-100',
    warning: 'bg-warning-50 text-warning-600 ring-warning-100',
};

// Sparkline paint per tint (SVG needs a colour value, so tokens go in as hsl(var)).
const SPARK_COLOR: Record<Tint, string> = {
    primary: 'hsl(var(--primary-500))',
    info: 'hsl(var(--info-500))',
    success: 'hsl(var(--success-500))',
    warning: 'hsl(var(--warning-500))',
};

function DeltaChip({
    delta,
    kind,
    compareLabel,
    neutral,
}: {
    delta: Delta;
    kind: DeltaKind;
    compareLabel: string;
    /** More or fewer is neither good nor bad (e.g. how many classes ran). */
    neutral?: boolean;
}) {
    const { t } = useTranslation('studyLibraryLiveClassDashboard');
    const ArrowIcon =
        delta.direction === 'up'
            ? ArrowUpRight
            : delta.direction === 'down'
              ? ArrowDownRight
              : ArrowRight;
    const unit = kind === 'rate' ? 'points' : kind === 'relative' ? 'percent' : 'plain';
    return (
        <TooltipProvider delayDuration={150}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <span
                        className={cn(
                            'inline-flex shrink-0 items-center gap-0.5 rounded-full px-2 py-0.5 text-caption font-semibold tabular-nums',
                            !neutral &&
                                delta.direction === 'up' &&
                                'bg-success-50 text-success-700',
                            !neutral &&
                                delta.direction === 'down' &&
                                'bg-danger-50 text-danger-600',
                            (neutral || delta.direction === 'flat') &&
                                'bg-neutral-100 text-neutral-600'
                        )}
                    >
                        <ArrowIcon size={12} weight="bold" />
                        {t(`delta.${unit}`, { v: formatDeltaValue(delta, kind) })}
                    </span>
                </TooltipTrigger>
                <TooltipContent>{t('delta.vs', { range: compareLabel })}</TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}

function Sparkline({ values, tint, id }: { values: Array<number | null>; tint: Tint; id: string }) {
    const points = values.map((v, i) => ({ i, v }));
    if (points.filter((p) => p.v !== null).length < 2) return null;
    const color = SPARK_COLOR[tint];
    return (
        <div className="h-12 w-28 shrink-0" aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={points} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                    <defs>
                        <linearGradient id={`lcdSpark-${id}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                            <stop offset="100%" stopColor={color} stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <Area
                        isAnimationActive={false}
                        type="monotone"
                        dataKey="v"
                        stroke={color}
                        strokeWidth={2}
                        fill={`url(#lcdSpark-${id})`}
                        connectNulls
                        dot={false}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}

interface KpiCardProps {
    id: string;
    icon: Icon;
    tint: Tint;
    label: string;
    value: string;
    detail: string;
    delta?: Delta | null;
    deltaKind?: DeltaKind;
    compareLabel?: string | null;
    neutralDelta?: boolean;
    spark?: Array<number | null>;
    /** Optional 0..1 meter under the value (share of the class stayed, etc.). */
    meter?: number | null;
    extra?: React.ReactNode;
}

function KpiCard({
    id,
    icon: IconCmp,
    tint,
    label,
    value,
    detail,
    delta,
    deltaKind = 'relative',
    compareLabel,
    neutralDelta,
    spark,
    meter,
    extra,
}: KpiCardProps) {
    return (
        <Card className="flex flex-col gap-4 rounded-xl border-neutral-200 p-5 shadow-sm transition-shadow hover:shadow-md">
            <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                    <span
                        className={cn(
                            'flex size-10 shrink-0 items-center justify-center rounded-lg ring-1',
                            ICON_TINT[tint]
                        )}
                    >
                        <IconCmp size={22} weight="duotone" />
                    </span>
                    <span className="truncate text-body font-semibold text-neutral-600">
                        {label}
                    </span>
                </div>
                {delta && compareLabel ? (
                    <DeltaChip
                        delta={delta}
                        kind={deltaKind}
                        compareLabel={compareLabel}
                        neutral={neutralDelta}
                    />
                ) : null}
            </div>
            <div className="flex items-end justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="text-h1 font-semibold tabular-nums text-neutral-900">
                            {value}
                        </span>
                        {extra}
                    </div>
                    <p className="mt-1 text-caption text-neutral-500">{detail}</p>
                </div>
                {spark ? <Sparkline values={spark} tint={tint} id={id} /> : null}
            </div>
            {meter !== undefined && meter !== null ? (
                <Progress
                    value={Math.min(100, Math.max(0, meter * 100))}
                    className="h-1.5 !bg-neutral-100"
                    aria-hidden
                />
            ) : null}
        </Card>
    );
}

export function Stars({ rating, size = 14 }: { rating: number | null; size?: number }) {
    if (rating === null) return null;
    return (
        <span className="flex items-center gap-0.5" aria-hidden>
            {[1, 2, 3, 4, 5].map((i) => (
                <Star
                    key={i}
                    size={size}
                    weight={
                        rating >= i - 0.25 ? 'fill' : rating >= i - 0.75 ? 'duotone' : 'regular'
                    }
                    className={rating >= i - 0.75 ? 'text-warning-500' : 'text-neutral-300'}
                />
            ))}
        </span>
    );
}

export function DashboardKpisSkeleton() {
    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-40 rounded-xl" />
            ))}
        </div>
    );
}

export function DashboardKpis({
    summary,
    previous,
    compareLabel,
    daily,
    classesTerm,
}: {
    summary: DashboardSummary;
    previous: DashboardSummary | null | undefined;
    compareLabel: string | null;
    daily: DashboardDailyPoint[];
    classesTerm: string;
}) {
    const { t } = useTranslation('studyLibraryLiveClassDashboard');
    const units = { h: t('units.hourShort'), m: t('units.minuteShort') };
    const prev = previous ?? null;
    // Rates only compare when the previous period actually had finished classes.
    const comparable = prev && prev.completed_classes > 0 ? prev : null;
    const tracked = summary.engagement_tracked;

    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <KpiCard
                id="classes"
                icon={VideoCamera}
                tint="info"
                label={t('kpis.classes', { term: classesTerm })}
                value={formatCount(summary.total_classes)}
                detail={t('kpis.classesDetail', {
                    completed: summary.completed_classes,
                    live: summary.live_classes,
                    upcoming: summary.upcoming_classes,
                })}
                delta={computeDelta(summary.total_classes, prev?.total_classes, 'relative')}
                deltaKind="relative"
                compareLabel={compareLabel}
                neutralDelta
                spark={daily.map((d) => d.classes)}
            />
            <KpiCard
                id="attendance"
                icon={UserCheck}
                tint="success"
                label={t('kpis.attendance')}
                value={formatRate(summary.attendance_rate)}
                detail={
                    summary.expected_learners > 0
                        ? t('kpis.attendanceDetail', {
                              present: formatCount(summary.present_in_audience),
                              expected: formatCount(summary.expected_learners),
                          })
                        : t('kpis.noCompleted')
                }
                delta={computeDelta(summary.attendance_rate, comparable?.attendance_rate, 'rate')}
                deltaKind="rate"
                compareLabel={compareLabel}
                spark={daily.map((d) => d.attendance_rate)}
            />
            <KpiCard
                id="joined"
                icon={UsersThree}
                tint="primary"
                label={t('kpis.avgJoined')}
                value={formatCount(summary.avg_joined_per_class)}
                detail={
                    summary.guests > 0
                        ? t('kpis.avgJoinedDetailGuests', {
                              joined: formatCount(summary.joined),
                              guests: formatCount(summary.guests),
                          })
                        : t('kpis.avgJoinedDetail', { joined: formatCount(summary.joined) })
                }
                delta={computeDelta(
                    summary.avg_joined_per_class,
                    comparable?.avg_joined_per_class,
                    'relative'
                )}
                deltaKind="relative"
                compareLabel={compareLabel}
                spark={daily.map((d) => (d.completed > 0 ? d.joined / d.completed : null))}
            />
            <KpiCard
                id="time"
                icon={Clock}
                tint="primary"
                label={t('kpis.timeInClass')}
                value={formatDuration(summary.avg_attended_minutes, units)}
                detail={
                    summary.avg_attended_minutes !== null
                        ? t('kpis.timeInClassDetail', {
                              scheduled: formatDuration(summary.avg_scheduled_minutes, units),
                              rate: formatRate(summary.avg_stay_rate),
                          })
                        : t('kpis.noDurationData')
                }
                delta={computeDelta(
                    summary.avg_attended_minutes,
                    comparable?.avg_attended_minutes,
                    'relative'
                )}
                deltaKind="relative"
                compareLabel={compareLabel}
                meter={summary.avg_stay_rate}
            />
            <KpiCard
                id="engagement"
                icon={ChatsCircle}
                tint="info"
                label={t('kpis.engagement')}
                value={formatRate(summary.engagement_rate)}
                detail={
                    tracked > 0
                        ? t('kpis.engagementBreakdown', {
                              spoke: formatRate(summary.spoke_count / tracked),
                              chatted: formatRate(summary.chatted_count / tracked),
                          })
                        : t('kpis.engagementNotTracked')
                }
                delta={computeDelta(summary.engagement_rate, comparable?.engagement_rate, 'rate')}
                deltaKind="rate"
                compareLabel={compareLabel}
                meter={summary.engagement_rate}
            />
            <KpiCard
                id="rating"
                icon={Star}
                tint="warning"
                label={t('kpis.rating')}
                value={formatRating(summary.avg_rating)}
                extra={<Stars rating={summary.avg_rating} />}
                detail={
                    summary.feedback_count > 0
                        ? t('kpis.ratingDetail', {
                              n: formatCount(summary.feedback_count),
                              rate: formatRate(summary.feedback_rate),
                          })
                        : t('kpis.noFeedback')
                }
                delta={computeDelta(summary.avg_rating, prev?.avg_rating, 'absolute')}
                deltaKind="absolute"
                compareLabel={compareLabel}
                spark={daily.map((d) => d.avg_rating)}
            />
        </div>
    );
}
