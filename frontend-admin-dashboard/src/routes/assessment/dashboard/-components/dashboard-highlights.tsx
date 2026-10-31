import { useMemo, useState } from 'react';
import type { Icon } from '@phosphor-icons/react';
import {
    ArrowRight,
    CheckCircle,
    HourglassMedium,
    Medal,
    Trophy,
    UsersFour,
    WarningCircle,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
    EmptyChart,
    SectionCard,
} from '@/routes/study-library/live-session/-components/dashboard/dashboard-charts';
import { Avatar } from '@/routes/study-library/live-session/-components/dashboard/dashboard-highlights';
import {
    EMPTY_VALUE,
    formatCount,
    formatRate,
    rateTone,
    type RateTone,
} from '@/routes/study-library/live-session/-utils/dashboard-format';
import type {
    AssessmentBatchStats,
    AssessmentDashboardRow,
    AssessmentLearnerStats,
} from '../-services/assessment-dashboard';
import { computeAssessmentInsights, evaluationQueue } from '../-utils/assessment-dashboard-utils';

// Progress's indicator is a child div; recolour it per tone.
export const METER_TONE: Record<RateTone, string> = {
    success: '[&>div]:bg-success-500',
    warning: '[&>div]:bg-warning-500',
    danger: '[&>div]:bg-danger-500',
    neutral: '[&>div]:bg-neutral-300',
};

export const TONE_TEXT: Record<RateTone, string> = {
    success: 'text-success-700',
    warning: 'text-warning-700',
    danger: 'text-danger-600',
    neutral: 'text-neutral-500',
};

// ─── Insights strip ─────────────────────────────────────────────────────────

type InsightTone = 'success' | 'danger' | 'warning' | 'info';

const INSIGHT_TONE: Record<InsightTone, string> = {
    success: 'bg-success-50 text-success-600',
    danger: 'bg-danger-50 text-danger-600',
    warning: 'bg-warning-50 text-warning-600',
    info: 'bg-info-50 text-info-600',
};

function InsightCard({
    icon: IconCmp,
    tone,
    label,
    title,
    meta,
    onClick,
}: {
    icon: Icon;
    tone: InsightTone;
    label: string;
    title: string;
    meta: string;
    onClick?: () => void;
}) {
    const body = (
        <>
            <span
                className={cn(
                    'flex size-10 shrink-0 items-center justify-center rounded-full',
                    INSIGHT_TONE[tone]
                )}
            >
                <IconCmp size={20} weight="duotone" />
            </span>
            <span className="flex min-w-0 flex-col text-left">
                <span className="text-caption font-semibold uppercase tracking-wide text-neutral-500">
                    {label}
                </span>
                <span className="truncate text-body font-semibold text-neutral-900" title={title}>
                    {title}
                </span>
                <span className="truncate text-caption text-neutral-500">{meta}</span>
            </span>
        </>
    );
    const shell =
        'flex min-w-0 items-center gap-3 rounded-xl border border-neutral-200 bg-card p-4 shadow-sm';
    return onClick ? (
        <Card
            role="button"
            tabIndex={0}
            onClick={onClick}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}
            className={cn(
                shell,
                'cursor-pointer transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300'
            )}
        >
            {body}
        </Card>
    ) : (
        <Card className={shell}>{body}</Card>
    );
}

export function InsightsStrip({
    rows,
    batches,
    batchLabel,
    onOpen,
}: {
    rows: AssessmentDashboardRow[];
    batches: AssessmentBatchStats[];
    batchLabel: (id: string) => string;
    onOpen: (row: AssessmentDashboardRow) => void;
}) {
    const { t } = useTranslation('assessmentDashboard');
    const insights = useMemo(() => computeAssessmentInsights(rows, batches), [rows, batches]);
    const { bestTest, lowestParticipation, topBatch, backlogTests, backlogSubmissions } = insights;
    if (rows.length === 0) return null;

    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {bestTest && (
                <InsightCard
                    icon={Trophy}
                    tone="success"
                    label={t('insights.best')}
                    title={bestTest.name || t('table.untitled')}
                    meta={t('insights.bestMeta', {
                        avg: formatRate(bestTest.avg_score),
                        n: formatCount(bestTest.scored),
                    })}
                    onClick={() => onOpen(bestTest)}
                />
            )}
            {lowestParticipation && (
                <InsightCard
                    icon={WarningCircle}
                    tone="danger"
                    label={t('insights.lowest')}
                    title={lowestParticipation.name || t('table.untitled')}
                    meta={t('insights.lowestMeta', {
                        rate: formatRate(lowestParticipation.participation_rate),
                        missed: formatCount(lowestParticipation.not_attempted),
                    })}
                    onClick={() => onOpen(lowestParticipation)}
                />
            )}
            {topBatch && (
                <InsightCard
                    icon={Medal}
                    tone="warning"
                    label={t('insights.topBatch')}
                    title={batchLabel(topBatch.package_session_id)}
                    meta={t('insights.topBatchMeta', {
                        avg: formatRate(topBatch.avg_score),
                        rate: formatRate(topBatch.participation_rate),
                    })}
                />
            )}
            <InsightCard
                icon={backlogTests > 0 ? HourglassMedium : CheckCircle}
                tone={backlogTests > 0 ? 'warning' : 'success'}
                label={t('insights.backlog')}
                title={
                    backlogTests > 0
                        ? t('insights.backlogTitle', { n: formatCount(backlogSubmissions) })
                        : t('insights.backlogNone')
                }
                meta={
                    backlogTests > 0
                        ? t('insights.backlogMeta', { count: backlogTests })
                        : t('insights.backlogNoneMeta')
                }
            />
        </div>
    );
}

// ─── Batch performance ─────────────────────────────────────────────────────

type BatchSort = 'lowest' | 'highest' | 'score';
const BATCH_SORTS: BatchSort[] = ['lowest', 'highest', 'score'];

export function BatchPerformanceCard({
    batches,
    batchLabel,
    batchTerm,
    batchesTerm,
}: {
    batches: AssessmentBatchStats[];
    batchLabel: (id: string) => string;
    batchTerm: string;
    batchesTerm: string;
}) {
    const { t } = useTranslation('assessmentDashboard');
    const [sort, setSort] = useState<BatchSort>('lowest');
    const rows = useMemo(() => {
        // Batches with no closed test have no participation yet — keep them last.
        const key = (b: AssessmentBatchStats) =>
            sort === 'score' ? b.avg_score : b.participation_rate;
        const rated = batches.filter((b) => key(b) !== null);
        const unrated = batches.filter((b) => key(b) === null);
        const sorted = [...rated].sort((a, b) =>
            sort === 'lowest' ? (key(a) ?? 0) - (key(b) ?? 0) : (key(b) ?? 0) - (key(a) ?? 0)
        );
        return [...sorted, ...unrated];
    }, [batches, sort]);

    return (
        <SectionCard
            icon={UsersFour}
            title={t('batches.title', { term: batchTerm })}
            subtitle={t('batches.subtitle')}
            right={
                <Tabs value={sort} onValueChange={(v) => setSort(v as BatchSort)}>
                    <TabsList className="h-auto">
                        {BATCH_SORTS.map((s) => (
                            <TabsTrigger key={s} value={s} className="text-caption">
                                {t(`batches.sort.${s}`)}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>
            }
        >
            {rows.length === 0 ? (
                <EmptyChart text={t('empty.noBatches', { term: batchesTerm.toLowerCase() })} />
            ) : (
                <ul className="-mx-2 flex max-h-96 flex-col overflow-y-auto">
                    {rows.map((b) => {
                        const value = sort === 'score' ? b.avg_score : b.participation_rate;
                        const tone = rateTone(value);
                        return (
                            <li
                                key={b.package_session_id}
                                className="flex flex-col gap-1.5 rounded-lg px-2 py-2.5 hover:bg-neutral-50"
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <span className="truncate text-body font-semibold text-neutral-800">
                                        {batchLabel(b.package_session_id)}
                                    </span>
                                    <span
                                        className={cn(
                                            'shrink-0 text-body font-semibold tabular-nums',
                                            TONE_TEXT[tone]
                                        )}
                                    >
                                        {formatRate(value)}
                                    </span>
                                </div>
                                <Progress
                                    value={(value ?? 0) * 100}
                                    className={cn('h-1.5 !bg-neutral-100', METER_TONE[tone])}
                                    aria-hidden
                                />
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-caption text-neutral-500">
                                    <span>
                                        {t('batches.meta', {
                                            count: b.assessments,
                                            attempted: formatCount(b.attempted),
                                            expected: formatCount(b.expected),
                                            avg: formatRate(b.avg_score),
                                        })}
                                    </span>
                                    {b.submissions > 0 && (
                                        <span
                                            className={cn(
                                                'font-semibold',
                                                b.awaiting_evaluation > 0
                                                    ? 'text-warning-700'
                                                    : 'text-success-700'
                                            )}
                                        >
                                            {t('batches.checked', {
                                                done: formatCount(b.evaluated),
                                                total: formatCount(b.submissions),
                                            })}
                                        </span>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </SectionCard>
    );
}

// ─── Top learners ──────────────────────────────────────────────────────────

export function TopLearnersCard({
    learners,
    batchLabel,
    learnersTerm,
}: {
    learners: AssessmentLearnerStats[];
    batchLabel: (id: string) => string;
    learnersTerm: string;
}) {
    const { t } = useTranslation('assessmentDashboard');
    return (
        <SectionCard
            icon={Trophy}
            title={t('top.title', { term: learnersTerm })}
            subtitle={t('top.subtitle')}
        >
            {learners.length === 0 ? (
                <EmptyChart text={t('kpis.noScores')} />
            ) : (
                <ol className="-mx-2 flex max-h-96 flex-col overflow-y-auto">
                    {learners.map((l, idx) => {
                        const tone = rateTone(l.avg_score);
                        return (
                            <li
                                key={l.user_id}
                                className="flex items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-neutral-50"
                            >
                                <span
                                    className={cn(
                                        'w-6 shrink-0 text-center text-caption font-semibold tabular-nums',
                                        idx < 3 ? 'text-primary-500' : 'text-neutral-400'
                                    )}
                                >
                                    {idx + 1}
                                </span>
                                <Avatar id={l.user_id} name={l.name || l.email} />
                                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="truncate text-body font-semibold text-neutral-900">
                                            {l.name || l.email || EMPTY_VALUE}
                                        </span>
                                        <span
                                            className={cn(
                                                'shrink-0 text-body font-semibold tabular-nums',
                                                TONE_TEXT[tone]
                                            )}
                                        >
                                            {formatRate(l.avg_score)}
                                        </span>
                                    </div>
                                    <Progress
                                        value={Math.max(0, (l.avg_score ?? 0) * 100)}
                                        className={cn('h-1.5 !bg-neutral-100', METER_TONE[tone])}
                                        aria-hidden
                                    />
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-caption text-neutral-500">
                                        {l.package_session_id && (
                                            <span className="truncate">
                                                {batchLabel(l.package_session_id)}
                                            </span>
                                        )}
                                        <span>{t('top.tests', { count: l.scored_tests })}</span>
                                        <span>
                                            {t('top.best', { best: formatRate(l.best_score) })}
                                        </span>
                                    </div>
                                </div>
                            </li>
                        );
                    })}
                </ol>
            )}
        </SectionCard>
    );
}

// ─── Evaluation queue ──────────────────────────────────────────────────────

export function EvaluationQueueCard({
    rows,
    onOpen,
    checkedBy,
}: {
    rows: AssessmentDashboardRow[];
    onOpen: (row: AssessmentDashboardRow) => void;
    /** Teachers who checked the test's copies so far. */
    checkedBy: (row: AssessmentDashboardRow) => string[];
}) {
    const { t } = useTranslation('assessmentDashboard');
    const queue = useMemo(() => evaluationQueue(rows), [rows]);
    return (
        <SectionCard
            icon={HourglassMedium}
            title={t('queue.title')}
            subtitle={
                queue.length > 0 ? t('queue.subtitle', { count: queue.length }) : t('queue.empty')
            }
        >
            {queue.length === 0 ? (
                <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-success-200 bg-success-50/40 text-center text-caption text-success-700">
                    <CheckCircle size={28} weight="duotone" />
                    {t('queue.allClear')}
                </div>
            ) : (
                <ul className="-mx-2 flex max-h-96 flex-col overflow-y-auto">
                    {queue.map((r) => {
                        const done = r.submissions > 0 ? r.evaluated / r.submissions : 0;
                        return (
                            <li
                                key={r.assessment_id}
                                className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-neutral-50"
                            >
                                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                                    <div className="flex items-center justify-between gap-3">
                                        <span
                                            className="truncate text-body font-semibold text-neutral-800"
                                            title={r.name}
                                        >
                                            {r.name || t('table.untitled')}
                                        </span>
                                        <span className="shrink-0 text-caption font-semibold tabular-nums text-neutral-600">
                                            {t('queue.done', {
                                                done: formatCount(r.evaluated),
                                                total: formatCount(r.submissions),
                                            })}
                                        </span>
                                    </div>
                                    <Progress
                                        value={done * 100}
                                        className={cn(
                                            'h-1.5 !bg-neutral-100',
                                            METER_TONE[done >= 1 ? 'success' : 'warning']
                                        )}
                                        aria-hidden
                                    />
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-caption">
                                        {r.awaiting_evaluation > 0 && (
                                            <span className="font-semibold text-warning-700">
                                                {t('queue.toEvaluate', {
                                                    n: formatCount(r.awaiting_evaluation),
                                                })}
                                            </span>
                                        )}
                                        {r.awaiting_release > 0 && (
                                            <span className="font-semibold text-info-700">
                                                {t('queue.toRelease', {
                                                    n: formatCount(r.awaiting_release),
                                                })}
                                            </span>
                                        )}
                                        {checkedBy(r).length > 0 && (
                                            <span
                                                className="truncate text-neutral-500"
                                                title={checkedBy(r).join(', ')}
                                            >
                                                {t('queue.by', { names: checkedBy(r).join(', ') })}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="small"
                                    layoutVariant="icon"
                                    aria-label={t('queue.open')}
                                    title={t('queue.open')}
                                    onClick={() => onOpen(r)}
                                >
                                    <ArrowRight size={14} />
                                </MyButton>
                            </li>
                        );
                    })}
                </ul>
            )}
        </SectionCard>
    );
}
