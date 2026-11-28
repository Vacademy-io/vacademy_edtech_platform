import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowsClockwise, Brain, CircleNotch, Sparkle, WarningCircle } from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { MyButton } from '@/components/design-system/button';
import { formatNumber } from '@/lib/formatters';
import {
    courseKnowledgeErrorDetail,
    useCourseKnowledgeStatus,
    useUpdateCourseKnowledgeSettings,
    type CourseKnowledgeStatus,
} from '@/services/course-knowledge-settings';
import {
    courseCoverageQueryKey,
    courseKnowledgeErrorMessage,
    courseKnowledgeErrorStatus,
    formatCredits,
    isAllSet,
    useCancelCourseRun,
    useCourseCoverage,
    useCourseRun,
    type CourseActiveRun,
    type CourseCoverage,
    type CourseLessonState,
    type CourseRun,
} from '@/services/course-knowledge';
import { MakeAiReadyDialog } from './MakeAiReadyDialog';
import { CoverageLessonTable, LessonStateChip } from './CoverageLessonTable';
import { SearchPreviewCard } from './SearchPreviewCard';
import { LinkedKnowledgeCard } from './LinkedKnowledgeCard';

const NAMESPACE = 'courseAiKnowledge';

interface AiKnowledgeTabProps {
    packageId: string;
}

/**
 * Course details → AI knowledge: what the student AI can read in this course,
 * the one "Make course AI-ready" flow, every lesson's state, and a search
 * preview. Renders nothing unless the platform has made course knowledge
 * available to the institute (the tab strip hides it then too).
 */
export const AiKnowledgeTab = ({ packageId }: AiKnowledgeTabProps) => {
    const statusQuery = useCourseKnowledgeStatus();
    const status = statusQuery.data;

    if (statusQuery.isLoading) return <TabSkeleton />;
    if (!status?.available) return null;
    if (!status.enabled) {
        // Links also drive the tutor, which does not need course knowledge on.
        return (
            <div className="flex flex-col gap-4">
                <TurnOnHero status={status} />
                {status.links_enabled && <LinkedKnowledgeCard packageId={packageId} />}
            </div>
        );
    }
    return <EnabledView packageId={packageId} status={status} />;
};

const TabSkeleton = () => (
    <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-36 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
    </div>
);

const TurnOnHero = ({ status }: { status: CourseKnowledgeStatus }) => {
    const { t } = useTranslation(NAMESPACE);
    const updateSettings = useUpdateCourseKnowledgeSettings();

    const turnOn = async () => {
        try {
            await updateSettings.mutateAsync({ enabled: true });
            toast.success(t('hero.turnedOn'));
        } catch (error) {
            toast.error(courseKnowledgeErrorDetail(error)?.message ?? t('hero.turnOnFailed'));
        }
    };

    return (
        <Card>
            <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary-50">
                    <Brain className="size-6 text-primary-500" />
                </span>
                <div className="flex flex-1 flex-col gap-2">
                    <h3 className="text-h3 font-semibold text-neutral-800">{t('hero.title')}</h3>
                    <p className="text-body text-neutral-600">{t('hero.body')}</p>
                    <div className="pt-2">
                        {status.can_manage ? (
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                onAsyncClick={turnOn}
                                loadingText={t('hero.turningOn')}
                            >
                                <Sparkle className="size-4" />
                                {t('hero.turnOn')}
                            </MyButton>
                        ) : (
                            <p className="text-body font-medium text-neutral-500">
                                {t('hero.askAdmin')}
                            </p>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};

const EnabledView = ({
    packageId,
    status,
}: {
    packageId: string;
    status: CourseKnowledgeStatus;
}) => {
    const { t } = useTranslation(NAMESPACE);
    const queryClient = useQueryClient();
    const coverageQuery = useCourseCoverage(packageId);
    const coverage = coverageQuery.data;
    const [dialogOpen, setDialogOpen] = useState(false);

    // The run being watched: the course's active run, or one the dialog just
    // started. It stays tracked until GET /runs says it ended, so the end is
    // noticed even after coverage stops reporting it.
    const [trackedRunId, setTrackedRunId] = useState<string | null>(null);
    const activeRunId = coverage?.active_run?.id ?? null;
    useEffect(() => {
        if (activeRunId) setTrackedRunId(activeRunId);
    }, [activeRunId]);

    const runQuery = useCourseRun(trackedRunId);
    const runStatus = runQuery.data?.status;
    // A run that no longer exists (deleted with the course AI data) stops being watched.
    const runGone = runQuery.isError && courseKnowledgeErrorStatus(runQuery.error) === 404;
    useEffect(() => {
        if (!trackedRunId) return;
        if (runGone || (runStatus !== undefined && runStatus !== 'RUNNING')) {
            setTrackedRunId(null);
            void queryClient.invalidateQueries({ queryKey: courseCoverageQueryKey(packageId) });
            if (runStatus === 'DONE' || runStatus === 'PARTIAL') {
                toast.success(
                    runQuery.data?.kind === 'PROCESS'
                        ? t('run.processFinished')
                        : t('run.scanFinished')
                );
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [runStatus, runGone]);

    // The freshest progress: the polled run while it is RUNNING, else coverage's view.
    const run: CourseRun | CourseActiveRun | null =
        trackedRunId && runQuery.data?.status === 'RUNNING'
            ? runQuery.data
            : coverage?.active_run ?? null;

    if (coverageQuery.isLoading) return <TabSkeleton />;

    if (coverageQuery.isError || !coverage) {
        return (
            <Card>
                <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
                    <WarningCircle className="size-8 text-danger-500" />
                    <p className="text-body text-neutral-700">
                        {courseKnowledgeErrorMessage(coverageQuery.error) ?? t('errors.load')}
                    </p>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => void coverageQuery.refetch()}
                    >
                        <ArrowsClockwise className="size-4" />
                        {t('errors.retry')}
                    </MyButton>
                </CardContent>
            </Card>
        );
    }

    if (coverage.totals.lessons === 0) {
        return (
            <Card>
                <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
                    <Brain className="size-8 text-neutral-400" />
                    <p className="text-subtitle font-semibold text-neutral-700">
                        {t('empty.title')}
                    </p>
                    <p className="text-body text-neutral-500">{t('empty.body')}</p>
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            <SummaryCard
                packageId={packageId}
                coverage={coverage}
                status={status}
                run={run}
                refreshing={coverageQuery.isFetching}
                onRefresh={() => void coverageQuery.refetch()}
                onOpenDialog={() => setDialogOpen(true)}
            />

            {status.links_enabled && <LinkedKnowledgeCard packageId={packageId} />}

            <CoverageLessonTable
                packageId={packageId}
                lessons={coverage.lessons}
                canUsePaid={status.can_manage && status.paid_available}
            />

            <SearchPreviewCard packageId={packageId} />

            <MakeAiReadyDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                packageId={packageId}
                status={status}
                coverage={coverage}
                run={run}
                onRunStarted={setTrackedRunId}
                onRefreshCoverage={() => coverageQuery.refetch()}
            />
        </div>
    );
};

/** Lessons the AI may read: every lesson except assessments. */
const readableLessons = (coverage: CourseCoverage) =>
    Math.max(0, coverage.totals.lessons - coverage.totals.excluded);

interface SummaryCardProps {
    packageId: string;
    coverage: CourseCoverage;
    status: CourseKnowledgeStatus;
    run: CourseRun | CourseActiveRun | null;
    refreshing: boolean;
    onRefresh: () => void;
    onOpenDialog: () => void;
}

const SummaryCard = ({
    packageId,
    coverage,
    status,
    run,
    refreshing,
    onRefresh,
    onOpenDialog,
}: SummaryCardProps) => {
    const { t } = useTranslation(NAMESPACE);
    const { totals, quote } = coverage;
    const cancelRun = useCancelCourseRun(packageId);

    const chips = useMemo(
        () =>
            (
                [
                    ['READY', totals.ready],
                    ['NEEDS_PROCESSING', totals.needs_processing],
                    ['PROCESSING', totals.processing],
                    ['NOT_SCANNED', totals.not_scanned],
                    ['CANT_READ', totals.cant_read],
                    ['FAILED', totals.failed],
                    ['EXCLUDED', totals.excluded],
                ] as Array<[CourseLessonState, number]>
            ).filter(([state, count]) => count > 0 || state !== 'FAILED'),
        [totals]
    );

    // Lessons the quote charges for can include uploaded videos not read yet.
    const quotedLessons = quote.items.reduce((sum, item) => sum + item.lessons, 0);
    const needProcessing = Math.max(totals.needs_processing, quotedLessons);
    const allSet = isAllSet(coverage);
    const runActive = run?.status === 'RUNNING';
    const progressValue = run && run.total > 0 ? Math.round((run.done * 100) / run.total) : 0;

    const stop = async () => {
        if (!run) return;
        try {
            await cancelRun.mutateAsync(run.id);
            toast.success(t('run.stopped'));
        } catch (error) {
            toast.error(courseKnowledgeErrorMessage(error) ?? t('run.stopFailed'));
        }
    };

    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    <Brain className="size-5 text-primary-500" />
                    {t('summary.title')}
                    {refreshing && <CircleNotch className="size-4 animate-spin text-neutral-400" />}
                    <span className="ms-auto flex flex-wrap gap-1">
                        {chips.map(([state, count]) => (
                            <span
                                key={state}
                                className="inline-flex items-center gap-1 text-caption"
                            >
                                <LessonStateChip state={state} label={t(`states.${state}`)} />
                                <span className="text-neutral-600">{formatNumber(count)}</span>
                            </span>
                        ))}
                    </span>
                </CardTitle>
                <p className="text-body text-neutral-500">
                    {t('summary.ready', {
                        ready: formatNumber(totals.ready),
                        count: readableLessons(coverage),
                    })}
                    {needProcessing > 0 && (
                        <>
                            {' '}
                            {t('summary.needProcessing', {
                                count: needProcessing,
                                credits: formatCredits(quote.credits),
                            })}
                        </>
                    )}
                    {totals.cant_read > 0 && (
                        <> {t('summary.cantRead', { count: totals.cant_read })}</>
                    )}
                    {totals.failed > 0 && <> {t('summary.failed', { count: totals.failed })}</>}
                </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-2">
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        disable={allSet && !runActive}
                        onClick={onOpenDialog}
                    >
                        <Sparkle className="size-4" />
                        {allSet && !runActive ? t('summary.allSet') : t('summary.makeReady')}
                    </MyButton>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        disable={refreshing}
                        onClick={onRefresh}
                    >
                        <ArrowsClockwise className="size-4" />
                        {t('summary.refresh')}
                    </MyButton>
                </div>

                {run && runActive && (
                    <div className="flex flex-col gap-2 rounded-md border border-primary-100 bg-primary-50 p-3">
                        <div className="flex flex-wrap items-center gap-2 text-body text-neutral-700">
                            <CircleNotch className="size-4 animate-spin text-primary-500" />
                            <span>
                                {run.kind === 'PROCESS'
                                    ? t('run.processing', {
                                          done: formatNumber(run.done),
                                          total: formatNumber(run.total),
                                      })
                                    : t('run.scanning', {
                                          done: formatNumber(run.done),
                                          total: formatNumber(run.total),
                                      })}
                            </span>
                            {'charged_credits' in run && run.kind === 'PROCESS' && (
                                <span className="text-caption text-neutral-500">
                                    {t('run.credits', {
                                        charged: formatCredits(run.charged_credits),
                                        quoted: formatCredits(run.quoted_credits),
                                    })}
                                </span>
                            )}
                            {status.can_manage && (
                                <MyButton
                                    buttonType="text"
                                    scale="small"
                                    className="ms-auto"
                                    onAsyncClick={stop}
                                    loadingText={t('run.stop')}
                                >
                                    {t('run.stop')}
                                </MyButton>
                            )}
                        </div>
                        <Progress
                            value={progressValue}
                            aria-label={t('run.progressAria')}
                            className="h-2 border border-primary-100"
                        />
                    </div>
                )}
            </CardContent>
        </Card>
    );
};
