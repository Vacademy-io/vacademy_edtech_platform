import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { format, parse } from 'date-fns';
import { ChartLineUp, DownloadSimple, FilePdf, Info, WarningCircle } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { getInstituteId } from '@/constants/helper';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { SendMessageDialog } from '@/routes/manage-students/students-list/-components/students-list/student-list-section/bulk-actions/send-message-dialog';
import { SendEmailDialog } from '@/routes/manage-students/students-list/-components/students-list/student-list-section/bulk-actions/send-email-dialog';
import type { MultiSelectOption } from '@/routes/study-library/live-session/feedback/-components/multi-select-popover';
import { buildCsv, downloadCsv } from '@/routes/study-library/live-session/feedback/-utils/csv';
import {
    PRINT_HIDE_ATTR,
    exportFileName,
    printElement,
} from '@/routes/study-library/live-session/-utils/dashboard-export';
import {
    resolveSubjectName,
    unresolvedSubjectIds,
    useSubjectNamesByIds,
} from '@/services/subject-names';
import {
    useAssessmentDashboard,
    type AssessmentDashboardParams,
    type AssessmentDashboardRow,
} from '../-services/assessment-dashboard';
import { useAssessmentDashboardStore } from '../-store/useAssessmentDashboardStore';
import {
    listTabForStatus,
    playModeKey,
    playModeOptions,
    toAssessmentDashboardUrl,
} from '../-utils/assessment-dashboard-utils';
import { DashboardFilters } from './dashboard-filters';
import { DashboardKpis, DashboardKpisSkeleton } from './dashboard-kpis';
import {
    ParticipationDonut,
    ScoreDistributionCard,
    SubmissionHeatmap,
    TrendCard,
    TypeCard,
} from './dashboard-charts';
import {
    BatchPerformanceCard,
    EvaluationQueueCard,
    InsightsStrip,
    TopLearnersCard,
} from './dashboard-highlights';
import { FollowUpCard } from './dashboard-followup';
import { CopyCheckingCard, evaluatorName } from './dashboard-evaluation';
import { LiveNowPanel } from './live-now-panel';
import { AssessmentsTable } from './assessments-table';

const stripDefault = (s: string) => s.replace(/^default\s+/i, '');

const toDate = (iso: string | null | undefined) => {
    if (!iso) return null;
    const d = parse(iso, 'yyyy-MM-dd', new Date());
    return Number.isNaN(d.getTime()) ? null : d;
};

/** "21 – 27 Sep 2026", "28 Sep – 4 Oct 2026", "27 Sep 2026". */
const formatRange = (startIso: string | null | undefined, endIso: string | null | undefined) => {
    const start = toDate(startIso);
    const end = toDate(endIso);
    if (!start || !end) return '';
    if (start.getTime() === end.getTime()) return format(end, 'dd MMM yyyy');
    const sameYear = start.getFullYear() === end.getFullYear();
    const sameMonth = sameYear && start.getMonth() === end.getMonth();
    const left = format(start, sameMonth ? 'dd' : sameYear ? 'dd MMM' : 'dd MMM yyyy');
    return `${left} – ${format(end, 'dd MMM yyyy')}`;
};

const pct = (v: number | null) => (v === null ? '' : Math.round(v * 100));

const printHide = { [PRINT_HIDE_ATTR]: '' };

/**
 * Assessment Dashboard: what is being written right now, and how the tests in a
 * date range went — who sat them, how they scored, what is still waiting to be
 * checked — by batch, type and learner, with follow-up and export.
 */
export default function AssessmentDashboard() {
    const { t } = useTranslation('assessmentDashboard');
    const navigate = useNavigate();
    const instituteId = getInstituteId() ?? '';
    const { instituteDetails } = useInstituteDetailsStore();
    const rootRef = useRef<HTMLDivElement>(null);

    const startDate = useAssessmentDashboardStore((s) => s.startDate);
    const endDate = useAssessmentDashboardStore((s) => s.endDate);
    const batchIds = useAssessmentDashboardStore((s) => s.batchIds);
    const playModes = useAssessmentDashboardStore((s) => s.playModes);
    const setRange = useAssessmentDashboardStore((s) => s.setRange);
    const setBatchIds = useAssessmentDashboardStore((s) => s.setBatchIds);
    const setPlayModes = useAssessmentDashboardStore((s) => s.setPlayModes);

    const batchTerm = getTerminology(ContentTerms.Batch, SystemTerms.Batch);
    const batchesTerm = getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch);
    const learnersTerm = getTerminologyPlural(RoleTerms.Learner, SystemTerms.Learner);
    const pageTitle = t('hero.title');

    // Keep the filters in the URL so a refresh or a bookmark reopens the same view.
    useEffect(() => {
        navigate({
            to: '/assessment/dashboard',
            search: toAssessmentDashboardUrl({ startDate, endDate, batchIds, playModes }),
            replace: true,
        });
    }, [navigate, startDate, endDate, batchIds, playModes]);

    const batchOptions: MultiSelectOption[] = useMemo(
        () =>
            instituteDetails?.batches_for_sessions?.map((batch) => ({
                value: batch.id,
                label:
                    batch.level.id === 'DEFAULT'
                        ? `${stripDefault(batch.package_dto.package_name)}, ${batch.session.session_name}`.trim()
                        : `${stripDefault(batch.level.level_name)} ${stripDefault(batch.package_dto.package_name)}, ${batch.session.session_name}`.trim(),
            })) ?? [],
        [instituteDetails?.batches_for_sessions]
    );
    const batchLabelMap = useMemo(
        () => new Map(batchOptions.map((o) => [o.value, o.label])),
        [batchOptions]
    );
    const batchLabel = useCallback(
        (id: string) => batchLabelMap.get(id) ?? t('batches.unknown'),
        [batchLabelMap, t]
    );

    const params: AssessmentDashboardParams = useMemo(
        () => ({ instituteId, startDate, endDate, batchIds, playModes }),
        [instituteId, startDate, endDate, batchIds, playModes]
    );
    const { data, isLoading, isFetching, error, refetch, dataUpdatedAt } =
        useAssessmentDashboard(params);

    const typeOptions: MultiSelectOption[] = useMemo(
        () =>
            playModeOptions(data?.mode_options, playModes).map((mode) => ({
                value: mode,
                label: t(`playModes.${playModeKey(mode)}`),
            })),
        [data?.mode_options, playModes, t]
    );

    // Subject names: the institute list first, then one lookup for the rest.
    const instituteSubjects = instituteDetails?.subjects;
    const subjectNamesById = useSubjectNamesByIds(
        unresolvedSubjectIds(
            instituteSubjects,
            (data?.assessments ?? []).map((r) => r.subject_id)
        )
    );
    const subjectLabel = useCallback(
        (id: string | null) => resolveSubjectName(instituteSubjects, subjectNamesById, id) || null,
        [instituteSubjects, subjectNamesById]
    );

    // Teacher names for the "checked by" lists in the queue, the table and the CSV.
    const evaluatorNameById = useMemo(
        () => new Map((data?.evaluators ?? []).map((e) => [e.user_id, evaluatorName(e)])),
        [data?.evaluators]
    );
    const checkedBy = useCallback(
        (row: AssessmentDashboardRow) =>
            row.evaluator_ids.map((id) => evaluatorNameById.get(id) ?? id),
        [evaluatorNameById]
    );

    const openTest = useCallback(
        (row: AssessmentDashboardRow) =>
            navigate({
                to: '/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab',
                params: {
                    assessmentId: row.assessment_id,
                    examType: row.play_mode,
                    assesssmentType: row.visibility ?? 'PRIVATE',
                    assessmentTab: listTabForStatus(row.status),
                },
            }),
        [navigate]
    );

    const exportTests = () => {
        if (!data) return;
        const csv = buildCsv(
            [
                t('csv.start'),
                t('csv.end'),
                t('csv.test'),
                t('csv.type'),
                t('csv.visibility'),
                t('csv.status'),
                t('csv.subject'),
                t('csv.batches'),
                t('csv.expected'),
                t('csv.attempted'),
                t('csv.participation'),
                t('csv.notAttempted'),
                t('csv.submissions'),
                t('csv.avgScore'),
                t('csv.highestScore'),
                t('csv.lowestScore'),
                t('csv.evaluated'),
                t('csv.awaitingEvaluation'),
                t('csv.awaitingRelease'),
                t('csv.checkedBy'),
            ],
            data.assessments.map((r) => [
                r.start_time ? format(new Date(r.start_time), 'yyyy-MM-dd HH:mm') : '',
                r.end_time ? format(new Date(r.end_time), 'yyyy-MM-dd HH:mm') : '',
                r.name,
                t(`playModes.${playModeKey(r.play_mode)}`),
                r.visibility,
                t(`status.${r.status}`),
                subjectLabel(r.subject_id),
                r.batch_ids.map(batchLabel).join(' | '),
                r.expected,
                r.attempted,
                pct(r.participation_rate),
                r.not_attempted,
                r.submissions,
                pct(r.avg_score),
                pct(r.highest_score),
                pct(r.lowest_score),
                r.evaluated,
                r.awaiting_evaluation,
                r.awaiting_release,
                checkedBy(r).join(' | '),
            ])
        );
        downloadCsv(exportFileName('assessments', startDate, endDate), csv);
    };

    const downloadPdf = () => {
        if (rootRef.current) {
            printElement(rootRef.current, `${pageTitle} ${formatRange(startDate, endDate)}`);
        }
    };

    const filters = (
        <div {...printHide}>
            <DashboardFilters
                startDate={startDate}
                endDate={endDate}
                onRangeChange={setRange}
                batchOptions={batchOptions}
                selectedBatchIds={batchIds}
                onBatchChange={setBatchIds}
                typeOptions={typeOptions}
                selectedTypes={playModes}
                onTypeChange={setPlayModes}
                batchesTerm={batchesTerm}
                isFetching={isFetching}
                onRefresh={() => refetch()}
            />
        </div>
    );

    const compareLabel = data?.previous_summary
        ? formatRange(data.previous_start_date, data.previous_end_date)
        : null;

    // Header band: what this is, which dates, compared with what, actions and filters.
    const hero = (
        <section className="flex flex-col gap-5 rounded-2xl border border-primary-100 bg-gradient-to-br from-primary-50 via-white to-info-50 p-4 shadow-sm sm:p-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex min-w-0 flex-col gap-1">
                    <span className="flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wide text-primary-600">
                        <ChartLineUp size={14} weight="bold" />
                        {t('hero.eyebrow')}
                    </span>
                    <h2 className="text-h2-semibold text-neutral-900">{pageTitle}</h2>
                    <p className="text-body text-neutral-600">
                        {formatRange(startDate, endDate)}
                        {compareLabel ? (
                            <span className="text-neutral-400">
                                {' · '}
                                {t('hero.compared', { range: compareLabel })}
                            </span>
                        ) : null}
                    </p>
                </div>
                <div className="flex flex-col items-start gap-2 lg:items-end">
                    {dataUpdatedAt ? (
                        <span className="flex shrink-0 items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1 text-caption text-neutral-600 shadow-sm">
                            <span className="size-2 rounded-full bg-success-500" aria-hidden />
                            {t('filters.updatedAt', { time: format(dataUpdatedAt, 'h:mm a') })}
                        </span>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2" {...printHide}>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            className="gap-1.5 bg-white sm:min-w-0"
                            onClick={exportTests}
                            disabled={!data || data.assessments.length === 0}
                        >
                            <DownloadSimple size={16} />
                            {t('share.csv')}
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            className="gap-1.5 bg-white sm:min-w-0"
                            onClick={downloadPdf}
                            disabled={!data}
                        >
                            <FilePdf size={16} />
                            {t('share.pdf')}
                        </MyButton>
                    </div>
                </div>
            </div>
            {filters}
        </section>
    );

    if (isLoading && !data) {
        return (
            <div className="flex flex-col gap-6">
                {hero}
                <DashboardKpisSkeleton />
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                    <Skeleton className="h-80 rounded-xl xl:col-span-2" />
                    <Skeleton className="h-80 rounded-xl" />
                </div>
            </div>
        );
    }

    if (error && !data) {
        return (
            <div className="flex flex-col gap-6">
                {hero}
                <Alert
                    variant="destructive"
                    className="flex flex-col gap-3 sm:flex-row sm:items-center"
                >
                    <WarningCircle size={20} className="shrink-0" />
                    <div className="flex-1">
                        <AlertTitle>{t('error.title')}</AlertTitle>
                        <AlertDescription>{t('error.body')}</AlertDescription>
                    </div>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => refetch()}
                    >
                        {t('error.retry')}
                    </MyButton>
                </Alert>
            </div>
        );
    }

    if (!data) return <div className="flex flex-col gap-6">{hero}</div>;

    return (
        <div ref={rootRef} className="flex flex-col gap-6">
            {hero}

            {!data.enrollment_available && (
                <div className="flex items-start gap-2 rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-body text-warning-700">
                    <Info size={18} className="mt-0.5 shrink-0" />
                    {t('warnings.enrollmentUnavailable', { term: batchesTerm.toLowerCase() })}
                </div>
            )}

            <LiveNowPanel rows={data.live_now} onOpen={openTest} />

            <DashboardKpis
                summary={data.summary}
                previous={data.previous_summary}
                compareLabel={compareLabel}
                daily={data.daily}
                learnersTerm={learnersTerm}
            />

            <InsightsStrip
                rows={data.assessments}
                batches={data.batches}
                batchLabel={batchLabel}
                onOpen={openTest}
            />

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <TrendCard daily={data.daily} />
                <ParticipationDonut summary={data.summary} />
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <CopyCheckingCard summary={data.summary} evaluators={data.evaluators ?? []} />
                <EvaluationQueueCard
                    rows={data.assessments}
                    onOpen={openTest}
                    checkedBy={checkedBy}
                />
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <ScoreDistributionCard buckets={data.score_distribution} summary={data.summary} />
                <TypeCard types={data.types} />
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <SubmissionHeatmap cells={data.submission_heatmap} />
                <TopLearnersCard
                    learners={data.top_learners}
                    batchLabel={batchLabel}
                    learnersTerm={learnersTerm}
                />
            </div>

            <BatchPerformanceCard
                batches={data.batches}
                batchLabel={batchLabel}
                batchTerm={batchTerm}
                batchesTerm={batchesTerm}
            />

            <FollowUpCard data={data} batchLabel={batchLabel} learnersTerm={learnersTerm} />

            <AssessmentsTable
                rows={data.assessments}
                truncated={data.assessments_truncated}
                limit={data.assessments_limit}
                batchLabel={batchLabel}
                subjectLabel={subjectLabel}
                checkedBy={checkedBy}
                onOpen={openTest}
            />

            <SendMessageDialog />
            <SendEmailDialog />
        </div>
    );
}
