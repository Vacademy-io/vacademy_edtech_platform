import type { Icon } from '@phosphor-icons/react';
import {
    ArrowDownRight,
    ArrowRight,
    ArrowUpRight,
    ClipboardText,
    HourglassMedium,
    PaperPlaneTilt,
    Target,
    UserCheck,
    UserMinus,
} from '@phosphor-icons/react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
    formatCount,
    formatRate,
} from '@/routes/study-library/live-session/-utils/dashboard-format';
import {
    computeDelta,
    formatDeltaValue,
    type Delta,
    type DeltaKind,
} from '@/routes/study-library/live-session/-utils/dashboard-insights';
import type {
    AssessmentDailyPoint,
    AssessmentDashboardSummary,
} from '../-services/assessment-dashboard';

type Tint = 'primary' | 'info' | 'success' | 'warning' | 'danger';

const ICON_TINT: Record<Tint, string> = {
    primary: 'bg-primary-50 text-primary-500 ring-primary-100',
    info: 'bg-info-50 text-info-600 ring-info-100',
    success: 'bg-success-50 text-success-600 ring-success-100',
    warning: 'bg-warning-50 text-warning-600 ring-warning-100',
    danger: 'bg-danger-50 text-danger-600 ring-danger-100',
};

// Sparkline paint per tint (SVG needs a colour value, so tokens go in as hsl(var)).
const SPARK_COLOR: Record<Tint, string> = {
    primary: 'hsl(var(--primary-500))',
    info: 'hsl(var(--info-500))',
    success: 'hsl(var(--success-500))',
    warning: 'hsl(var(--warning-500))',
    danger: 'hsl(var(--danger-500))',
};

/**
 * ▲/▼ against the previous period. `invert` is for counts where more is worse
 * (learners who skipped), `neutral` for counts that are neither (tests held).
 */
function DeltaChip({
    delta,
    kind,
    compareLabel,
    neutral,
    invert,
}: {
    delta: Delta;
    kind: DeltaKind;
    compareLabel: string;
    neutral?: boolean;
    invert?: boolean;
}) {
    const { t } = useTranslation('assessmentDashboard');
    const ArrowIcon =
        delta.direction === 'up'
            ? ArrowUpRight
            : delta.direction === 'down'
              ? ArrowDownRight
              : ArrowRight;
    const unit = kind === 'rate' ? 'points' : kind === 'relative' ? 'percent' : 'plain';
    const good = invert ? delta.direction === 'down' : delta.direction === 'up';
    const bad = invert ? delta.direction === 'up' : delta.direction === 'down';
    return (
        <TooltipProvider delayDuration={150}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <span
                        className={cn(
                            'inline-flex shrink-0 items-center gap-0.5 rounded-full px-2 py-0.5 text-caption font-semibold tabular-nums',
                            !neutral && good && 'bg-success-50 text-success-700',
                            !neutral && bad && 'bg-danger-50 text-danger-600',
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
                        <linearGradient id={`adSpark-${id}`} x1="0" y1="0" x2="0" y2="1">
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
                        fill={`url(#adSpark-${id})`}
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
    invertDelta?: boolean;
    spark?: Array<number | null>;
    /** Optional 0..1 meter under the value. */
    meter?: number | null;
    meterTone?: 'primary' | 'success' | 'warning' | 'danger';
}

const METER_TONE = {
    primary: '',
    success: '[&>div]:bg-success-500',
    warning: '[&>div]:bg-warning-500',
    danger: '[&>div]:bg-danger-500',
} as const;

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
    invertDelta,
    spark,
    meter,
    meterTone = 'primary',
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
                        invert={invertDelta}
                    />
                ) : null}
            </div>
            <div className="flex items-end justify-between gap-3">
                <div className="min-w-0">
                    <span className="text-h1 font-semibold tabular-nums text-neutral-900">
                        {value}
                    </span>
                    <p className="mt-1 text-caption text-neutral-500">{detail}</p>
                </div>
                {spark ? <Sparkline values={spark} tint={tint} id={id} /> : null}
            </div>
            {meter !== undefined && meter !== null ? (
                <Progress
                    value={Math.min(100, Math.max(0, meter * 100))}
                    className={cn('h-1.5 !bg-neutral-100', METER_TONE[meterTone])}
                    aria-hidden
                />
            ) : null}
        </Card>
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
    learnersTerm,
}: {
    summary: AssessmentDashboardSummary;
    previous: AssessmentDashboardSummary | null | undefined;
    compareLabel: string | null;
    daily: AssessmentDailyPoint[];
    learnersTerm: string;
}) {
    const { t } = useTranslation('assessmentDashboard');
    const prev = previous ?? null;
    // Participation only compares when the previous period had closed tests.
    const comparable = prev && prev.closed_assessments > 0 ? prev : null;
    const backlog = summary.awaiting_evaluation + summary.awaiting_release;
    const learners = learnersTerm.toLowerCase();

    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <KpiCard
                id="tests"
                icon={ClipboardText}
                tint="info"
                label={t('kpis.tests')}
                value={formatCount(summary.total_assessments)}
                detail={t('kpis.testsDetail', {
                    closed: summary.closed_assessments,
                    live: summary.live_assessments,
                    upcoming: summary.upcoming_assessments,
                    open: summary.open_assessments,
                })}
                delta={computeDelta(summary.total_assessments, prev?.total_assessments, 'relative')}
                deltaKind="relative"
                compareLabel={compareLabel}
                neutralDelta
                spark={daily.map((d) => d.assessments)}
            />
            <KpiCard
                id="participation"
                icon={UserCheck}
                tint="success"
                label={t('kpis.participation')}
                value={formatRate(summary.participation_rate)}
                detail={
                    summary.expected_learners > 0
                        ? t('kpis.participationDetail', {
                              attempted: formatCount(summary.attempted_learners),
                              expected: formatCount(summary.expected_learners),
                              term: learners,
                          })
                        : t('kpis.noClosed')
                }
                delta={computeDelta(
                    summary.participation_rate,
                    comparable?.participation_rate,
                    'rate'
                )}
                deltaKind="rate"
                compareLabel={compareLabel}
                meter={summary.participation_rate}
                meterTone="success"
            />
            <KpiCard
                id="submissions"
                icon={PaperPlaneTilt}
                tint="primary"
                label={t('kpis.submissions')}
                value={formatCount(summary.submissions)}
                detail={t('kpis.submissionsDetail', {
                    n: formatCount(summary.unique_learners),
                    term: learners,
                })}
                delta={computeDelta(summary.submissions, prev?.submissions, 'relative')}
                deltaKind="relative"
                compareLabel={compareLabel}
                spark={daily.map((d) => d.submissions)}
            />
            <KpiCard
                id="score"
                icon={Target}
                tint="primary"
                label={t('kpis.avgScore')}
                value={formatRate(summary.avg_score)}
                detail={
                    summary.scored > 0
                        ? t('kpis.avgScoreDetail', {
                              n: formatCount(summary.scored),
                              top: formatRate(summary.highest_score),
                          })
                        : t('kpis.noScores')
                }
                delta={computeDelta(summary.avg_score, prev?.avg_score, 'rate')}
                deltaKind="rate"
                compareLabel={compareLabel}
                spark={daily.map((d) => d.avg_score)}
            />
            <KpiCard
                id="missed"
                icon={UserMinus}
                tint="danger"
                label={t('kpis.notAttempted')}
                value={formatCount(summary.not_attempted)}
                detail={
                    summary.expected_learners > 0
                        ? t('kpis.notAttemptedDetail', {
                              count: summary.closed_assessments,
                          })
                        : t('kpis.noClosed')
                }
                delta={computeDelta(summary.not_attempted, comparable?.not_attempted, 'relative')}
                deltaKind="relative"
                compareLabel={compareLabel}
                invertDelta
            />
            <KpiCard
                id="backlog"
                icon={HourglassMedium}
                tint="warning"
                label={t('kpis.backlog')}
                value={formatCount(backlog)}
                detail={
                    backlog > 0
                        ? t('kpis.backlogDetail', {
                              evaluate: formatCount(summary.awaiting_evaluation),
                              release: formatCount(summary.awaiting_release),
                          })
                        : summary.submissions > 0
                          ? t('kpis.backlogClear')
                          : t('kpis.noSubmissions')
                }
                meter={summary.submissions > 0 ? summary.evaluated / summary.submissions : null}
                meterTone={backlog > 0 ? 'warning' : 'success'}
            />
        </div>
    );
}
