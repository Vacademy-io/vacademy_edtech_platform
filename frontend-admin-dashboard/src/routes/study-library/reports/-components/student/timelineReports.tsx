import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MyButton } from '@/components/design-system/button';
import { SearchableSelect } from '@/components/design-system/searchable-select';
import {
    CheckCircle,
    Clock,
    Brain,
    ChartLineUp,
    Export,
    FileCsv,
    Warning,
} from '@phosphor-icons/react';
import { buildMetricInfo } from '../metricInfo';
import { ReportHeader, MetricCard, SectionCard } from '../reportUi';
import ReportRecipientsDialogBox from './reportRecipientsDialogBox';
import { useQueries } from '@tanstack/react-query';
import { fetchLearnersReport, fetchSlideWiseProgress } from '../../-services/utils';
import { resolveInstituteLogoUrl } from '../live/-utils/instituteLogo';
import { exportLearnerLearningPdf } from '../../-utils/exportLearningPdf';
import { useLearnerDetailsForBatches } from '../../-store/useLearnersDetails';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import {
    LearnersReportResponse,
    learnersReportColumns,
    SlideData,
    SlidesColumns,
} from '../../-types/types';
import { MyTable } from '@/components/design-system/table';
import { LineChartComponent } from './lineChart';
import {
    transformLearnersReport,
    transformToChartData,
    formatToTwoDecimalPlaces,
    convertMinutesToTimeFormat,
} from '../../-services/helper';
import dayjs from 'dayjs';
import { useSearch } from '@tanstack/react-router';
import { Route } from '@/routes/study-library/reports';
import { toast } from 'sonner';
import { ContentTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import DateRangeFilter from '@/components/design-system/date-range-filter';
import BatchMultiSelect, { useBatchLookup, type BatchOption } from '../batchMultiSelect';
import { buildReportCsv, csvFileName, downloadCsv, num, csvDate } from '../../-utils/reportCsv';

const buildFormSchema = (t: TFunction) =>
    z
        .object({
            batches: z.array(z.string()).min(1, t('form.batchRequired')),
            student: z.string().min(1, t('form.studentRequired')),
            startDate: z.string().min(1, t('form.startDateRequired')),
            endDate: z.string().min(1, t('form.endDateRequired')),
        })
        .refine(
            (data) => {
                const start = new Date(data.startDate);
                const end = new Date(data.endDate);
                const diffInDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
                return diffInDays <= 30;
            },
            {
                message: t('form.dateRangeTooLong'),
                path: ['startDate'],
            }
        );

type FormValues = z.infer<ReturnType<typeof buildFormSchema>>;

interface AppliedFilters {
    userId: string;
    learnerName: string;
    /** Only the selected batches this learner is actually enrolled in. */
    batchIds: string[];
    startDate: string;
    endDate: string;
    /**
     * Stamped per "Generate" click and part of every query key, so re-running the
     * same batch + range always fetches fresh numbers (the mutation-based
     * version fetched on every click) while paging within a run stays cached.
     */
    runId: number;
}

interface BatchResult {
    batchId: string;
    option: BatchOption | undefined;
    report: LearnersReportResponse | undefined;
    reportError: boolean;
    slides: SlideData[] | undefined;
}

// Courses shallower than the full Subject → Module → Chapter structure come
// back with the literal "DEFAULT" placeholder for the missing level(s).
// Rather than showing a whole column of "DEFAULT" in the per-date slide
// tables, hide any structural column whose every slide (across all dates) is
// that placeholder, and apply the same visibility to each table.
const isSlideColumnAllDefault = (
    slides: SlideData[] | undefined,
    key: 'subject_name' | 'module_name' | 'chapter_name'
) => {
    const all = (slides ?? []).flatMap((day) => day.slide_details ?? []);
    return (
        all.length > 0 &&
        all.every((detail) => (detail[key] ?? '').toString().trim().toUpperCase() === 'DEFAULT')
    );
};

export default function TimelineReports() {
    const { t } = useTranslation([
        'studyLibraryStudentTimelineReports',
        'studyLibraryExportLearningPdf',
        'studyLibraryReportsMetricInfo',
    ]);
    const METRIC_INFO = buildMetricInfo(t);
    const { getPackageSessionId } = useInstituteDetailsStore();
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const tokenData = getTokenDecodedData(accessToken);
    const INSTITUTE_ID = tokenData && Object.keys(tokenData.authorities)[0];
    const instituteDetails = useInstituteDetailsStore((s) => s.instituteDetails);
    const batchLookup = useBatchLookup();
    const batchTerm = getTerminology(ContentTerms.Batch, SystemTerms.Batch);
    const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);
    const learnerTerm = getTerminology(RoleTerms.Learner, SystemTerms.Learner);
    const search = useSearch({ from: Route.id });

    const [applied, setApplied] = useState<AppliedFilters | null>(null);
    const [isExportingPdf, setIsExportingPdf] = useState<string | null>(null);
    const [isExportingCsv, setIsExportingCsv] = useState(false);

    const {
        handleSubmit,
        setValue,
        watch,
        clearErrors,
        formState: { errors },
    } = useForm<FormValues>({
        resolver: zodResolver(buildFormSchema(t)),
        defaultValues: { batches: [], student: '', startDate: '', endDate: '' },
    });

    const selectedBatches = watch('batches');
    const selectedStudent = watch('student');

    // Learners across every selected batch, each knowing which batches it is in.
    const { learners: studentList, isLoading: isLearnersLoading } = useLearnerDetailsForBatches(
        selectedBatches,
        INSTITUTE_ID || ''
    );

    // A learner that is no longer in any selected batch can't stay picked.
    useEffect(() => {
        if (
            selectedStudent &&
            !isLearnersLoading &&
            !studentList.some((s) => s.user_id === selectedStudent)
        ) {
            setValue('student', '');
        }
    }, [studentList, isLearnersLoading, selectedStudent, setValue]);

    // ── Prefill from URL search param (?studentReport=…) ─────────────────────
    // When the user lands here from the learner profile's "Learning Timeline"
    // button, the URL carries the courseId / sessionId / levelId / userId so
    // they don't have to re-pick. The batch resolves immediately from the
    // institute store; the learner is set once that batch's list has loaded.
    const prefill = search.studentReport;
    // Each half applies exactly once: the batch as soon as the institute store
    // can resolve it, the learner as soon as that batch's list contains them.
    // Without the guards an institute refetch (new `instituteDetails` identity)
    // or a later list change would snap the admin's own picks back to the URL.
    const prefillBatchDone = useRef(false);
    const prefillLearnerDone = useRef(false);
    useEffect(() => {
        if (prefillBatchDone.current) return;
        if (prefill?.courseId && prefill.sessionId && prefill.levelId) {
            const batchId = getPackageSessionId({
                courseId: prefill.courseId,
                sessionId: prefill.sessionId,
                levelId: prefill.levelId,
            });
            if (batchId) {
                setValue('batches', [batchId]);
                prefillBatchDone.current = true;
            }
        } else {
            prefillBatchDone.current = true;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [instituteDetails]);
    useEffect(() => {
        if (prefillLearnerDone.current) return;
        if (prefill?.userId && studentList.some((s) => s.user_id === prefill.userId)) {
            setValue('student', prefill.userId);
            prefillLearnerDone.current = true;
        }
    }, [studentList, prefill?.userId, setValue]);

    const onSubmit = (data: FormValues) => {
        const learner = studentList.find((s) => s.user_id === data.student);
        const batchIds = data.batches.filter((id) => learner?.batchIds.includes(id));
        if (!batchIds.length) {
            toast.error(t('toast.learnerNotInBatches'));
            return;
        }
        setApplied({
            userId: data.student,
            learnerName: learner?.full_name ?? '',
            batchIds,
            startDate: data.startDate,
            endDate: data.endDate,
            runId: Date.now(),
        });
    };

    // ── Data: one learner report + one slide timeline per batch ──────────────
    const reportQueries = useQueries({
        queries: (applied?.batchIds ?? []).map((batchId) => ({
            queryKey: [
                'learnerTimelineReport',
                applied?.userId,
                batchId,
                applied?.startDate,
                applied?.endDate,
                applied?.runId,
            ],
            queryFn: () =>
                fetchLearnersReport({
                    start_date: applied?.startDate ?? '',
                    end_date: applied?.endDate ?? '',
                    package_session_id: batchId,
                    user_id: applied?.userId ?? '',
                }) as Promise<LearnersReportResponse>,
            staleTime: 5 * 60 * 1000,
        })),
    });
    const slideQueries = useQueries({
        queries: (applied?.batchIds ?? []).map((batchId) => ({
            queryKey: [
                'learnerSlideTimeline',
                applied?.userId,
                batchId,
                applied?.startDate,
                applied?.endDate,
                applied?.runId,
            ],
            queryFn: () =>
                fetchSlideWiseProgress({
                    start_date: applied?.startDate ?? '',
                    end_date: applied?.endDate ?? '',
                    package_session_id: batchId,
                    user_id: applied?.userId ?? '',
                }) as Promise<SlideData[]>,
            staleTime: 5 * 60 * 1000,
        })),
    });
    const isPending = reportQueries.some((q) => q.isLoading);
    const resultsKey = reportQueries
        .map((q) => `${q.status}:${q.dataUpdatedAt}`)
        .concat(slideQueries.map((q) => `${q.status}:${q.dataUpdatedAt}`))
        .join('|');
    const results = useMemo<BatchResult[]>(
        () =>
            (applied?.batchIds ?? []).map((batchId, index) => ({
                batchId,
                option: batchLookup.get(batchId),
                report: reportQueries[index]?.data,
                reportError: Boolean(reportQueries[index]?.isError),
                slides: slideQueries[index]?.data,
            })),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [applied, batchLookup, resultsKey]
    );
    const isMulti = (applied?.batchIds.length ?? 0) > 1;
    const hasAnyReport = results.some((r) => r.report);
    const blockTitle = (r: BatchResult) => r.option?.label || r.option?.courseName || '';
    const dateRangeLabel = applied
        ? `${dayjs(applied.startDate).format('DD MMM YYYY')} — ${dayjs(applied.endDate).format('DD MMM YYYY')}`
        : '';

    // ── Exports ──────────────────────────────────────────────────────────────
    const handleExportPdf = async (result: BatchResult) => {
        if (!result.report || !applied) return;
        setIsExportingPdf(result.batchId);
        try {
            const logoUrl = await resolveInstituteLogoUrl(instituteDetails?.institute_logo_file_id);
            await exportLearnerLearningPdf(
                {
                    instituteName: instituteDetails?.institute_name || 'Vacademy',
                    logoUrl,
                    courseName: result.option?.label || '',
                    dateRange: dateRangeLabel,
                    learnerName: applied.learnerName,
                },
                result.report,
                t,
                {
                    slides: result.slides ?? [],
                    hideModule: isSlideColumnAllDefault(result.slides, 'module_name'),
                    hideChapter: isSlideColumnAllDefault(result.slides, 'chapter_name'),
                    moduleTerm: getTerminology(ContentTerms.Module, SystemTerms.Module),
                    chapterTerm: getTerminology(ContentTerms.Chapter, SystemTerms.Chapter),
                }
            );
            toast.success(t('toast.exportSuccess'));
        } catch {
            toast.error(t('toast.exportFailed'));
        } finally {
            setIsExportingPdf(null);
        }
    };

    const handleExportCsv = () => {
        if (!applied || !hasAnyReport) return;
        setIsExportingCsv(true);
        try {
            const csv = buildReportCsv([
                {
                    title: t('csv.summaryTitle'),
                    headers: [
                        batchTerm,
                        courseTerm,
                        learnerTerm,
                        t('csv.startDate'),
                        t('csv.endDate'),
                        t('csv.learnerCourseCompleted', { term: courseTerm }),
                        t('csv.batchCourseCompleted', { term: courseTerm, batch: batchTerm }),
                        t('csv.learnerDailyTimeMin'),
                        t('csv.batchDailyTimeMin', { batch: batchTerm }),
                        t('csv.learnerConcentration'),
                        t('csv.batchConcentration', { batch: batchTerm }),
                    ],
                    rows: results
                        .filter((r) => r.report)
                        .map((r) => [
                            blockTitle(r),
                            r.option?.courseName ?? '',
                            applied.learnerName,
                            applied.startDate,
                            applied.endDate,
                            num(r.report?.learner_progress_report?.percentage_course_completed),
                            num(r.report?.batch_progress_report?.percentage_course_completed),
                            num(r.report?.learner_progress_report?.avg_time_spent_in_minutes),
                            num(r.report?.batch_progress_report?.avg_time_spent_in_minutes),
                            num(r.report?.learner_progress_report?.percentage_concentration_score),
                            num(r.report?.batch_progress_report?.percentage_concentration_score),
                        ]),
                },
                {
                    title: t('csv.dailyTitle'),
                    headers: [
                        batchTerm,
                        t('csv.date'),
                        t('csv.learnerTimeMin'),
                        t('csv.batchAvgTimeMin', { batch: batchTerm }),
                    ],
                    rows: results.flatMap((r) => {
                        if (!r.report) return [];
                        const byDate = new Map<string, { learner?: number; batch?: number }>();
                        r.report.learner_progress_report.daily_time_spent.forEach((d) =>
                            byDate.set(d.activity_date, {
                                ...byDate.get(d.activity_date),
                                learner: d.avg_daily_time_minutes,
                            })
                        );
                        r.report.batch_progress_report.daily_time_spent.forEach((d) =>
                            byDate.set(d.activity_date, {
                                ...byDate.get(d.activity_date),
                                batch: d.avg_daily_time_minutes,
                            })
                        );
                        return Array.from(byDate.entries())
                            .sort(([a], [b]) => a.localeCompare(b))
                            .map(([date, v]) => [
                                blockTitle(r),
                                csvDate(date),
                                num(v.learner ?? 0),
                                num(v.batch ?? 0),
                            ]);
                    }),
                },
                {
                    title: t('csv.slidesTitle'),
                    headers: [
                        batchTerm,
                        t('csv.date'),
                        t('csv.slide', {
                            term: getTerminology(ContentTerms.Slides, SystemTerms.Slides),
                        }),
                        getTerminology(ContentTerms.Subjects, SystemTerms.Subjects),
                        getTerminology(ContentTerms.Modules, SystemTerms.Modules),
                        getTerminology(ContentTerms.Chapters, SystemTerms.Chapters),
                        t('csv.concentration'),
                        t('csv.timeSpentMin'),
                    ],
                    rows: results.flatMap((r) =>
                        (r.slides ?? []).flatMap((day) =>
                            (day.slide_details ?? []).map((slide) => [
                                blockTitle(r),
                                csvDate(day.date),
                                slide.slide_title,
                                slide.subject_name,
                                slide.module_name,
                                slide.chapter_name,
                                num(slide.concentration_score),
                                num(parseFloat(slide.time_spent)),
                            ])
                        )
                    ),
                },
            ]);
            downloadCsv(
                csvFileName(
                    t('csv.fileStem'),
                    applied.learnerName,
                    applied.startDate,
                    applied.endDate
                ),
                csv
            );
            toast.success(t('toast.csvExportSuccess'));
        } catch {
            toast.error(t('toast.csvExportFailed'));
        } finally {
            setIsExportingCsv(false);
        }
    };

    const exportPdfButton = (result: BatchResult) => (
        <MyButton
            buttonType="secondary"
            onClick={() => handleExportPdf(result)}
            disable={isExportingPdf === result.batchId}
            className="h-9 px-4 text-body"
        >
            <Export className="me-1.5 size-4" />
            {isExportingPdf === result.batchId ? t('actions.exporting') : t('actions.exportPdf')}
        </MyButton>
    );

    return (
        <div className="space-y-6">
            {/* Filter card */}
            <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <BatchMultiSelect
                            selected={selectedBatches}
                            onChange={(ids) => {
                                setValue('batches', ids);
                                if (ids.length) clearErrors('batches');
                            }}
                            error={errors.batches?.message}
                        />
                        <div className="flex flex-col gap-1">
                            <label className="text-caption font-medium text-neutral-700">
                                {learnerTerm}
                                <span className="ms-1 text-danger-600">*</span>
                            </label>
                            <SearchableSelect
                                options={studentList.map((s) => ({
                                    label: s.full_name,
                                    value: s.user_id,
                                }))}
                                value={selectedStudent || ''}
                                onChange={(value) => {
                                    setValue('student', value);
                                    clearErrors('student');
                                }}
                                placeholder={
                                    isLearnersLoading
                                        ? t('form.loadingStudents')
                                        : t('form.selectStudent')
                                }
                                searchPlaceholder={t('form.searchStudent')}
                                emptyText={t('form.noStudentsFound')}
                                disabled={!selectedBatches.length || !studentList.length}
                                triggerClassName="h-9 text-body"
                            />
                            {errors.student ? (
                                <span className="text-caption text-danger-600">
                                    {errors.student.message}
                                </span>
                            ) : (
                                <span className="text-caption text-neutral-500">
                                    {selectedBatches.length
                                        ? t('form.learnerHint', { count: studentList.length })
                                        : t('form.pickBatchFirst', {
                                              batch: batchTerm.toLowerCase(),
                                          })}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Date Selection and Generate Button Row */}
                    <div className="flex w-full flex-col gap-4 sm:flex-row sm:items-end">
                        <div className="flex-1">
                            <DateRangeFilter
                                onChange={(res) => {
                                    if (res) {
                                        const [sDay, sMonth, sYear] = res.startDate.split('/');
                                        const [eDay, eMonth, eYear] = res.endDate.split('/');
                                        setValue('startDate', `${sYear}-${sMonth}-${sDay}`);
                                        setValue('endDate', `${eYear}-${eMonth}-${eDay}`);
                                        clearErrors('startDate');
                                        clearErrors('endDate');
                                    } else {
                                        setValue('startDate', '');
                                        setValue('endDate', '');
                                    }
                                }}
                            />
                        </div>
                        <div className="sm:mb-1">
                            <MyButton
                                type="submit"
                                buttonType="primary"
                                className="h-9 px-4 text-body font-medium"
                            >
                                {t('actions.generateReport')}
                            </MyButton>
                        </div>
                    </div>

                    {/* Date errors (batch / learner errors sit under their own controls) */}
                    {(errors.startDate || errors.endDate) && (
                        <div className="rounded-md border border-danger-200 bg-danger-50 p-3">
                            <div className="text-body text-danger-700">
                                <p className="mb-1 font-medium">{t('form.errorsHeading')}</p>
                                <ul className="space-y-1">
                                    {errors.startDate && (
                                        <li className="text-caption">
                                            • {errors.startDate.message}
                                        </li>
                                    )}
                                    {errors.endDate && (
                                        <li className="text-caption">• {errors.endDate.message}</li>
                                    )}
                                </ul>
                            </div>
                        </div>
                    )}
                </form>
            </div>

            {isPending && <DashboardLoader />}

            {applied && !isPending && hasAnyReport && (
                <div className="space-y-6">
                    {/* Report Header */}
                    <ReportHeader
                        title={applied.learnerName}
                        chips={
                            <>
                                {isMulti && (
                                    <span className="rounded-md bg-primary-50 px-2 py-1 text-caption font-medium text-neutral-700">
                                        {t('report.batchCount', {
                                            count: results.length,
                                            term: batchTerm,
                                        })}
                                    </span>
                                )}
                                <span className="text-caption text-neutral-500">
                                    {t('report.duration')}
                                </span>
                                <span className="rounded-md bg-primary-50 px-2 py-1 text-caption font-medium text-neutral-700">
                                    {dayjs(applied.startDate).format('DD MMM YYYY')}
                                </span>
                                <span className="text-neutral-400">—</span>
                                <span className="rounded-md bg-primary-50 px-2 py-1 text-caption font-medium text-neutral-700">
                                    {dayjs(applied.endDate).format('DD MMM YYYY')}
                                </span>
                            </>
                        }
                        actions={
                            <>
                                <ReportRecipientsDialogBox userId={applied.userId} />
                                {!isMulti && results[0]?.report && exportPdfButton(results[0])}
                                <MyButton
                                    buttonType="secondary"
                                    onClick={handleExportCsv}
                                    disable={isExportingCsv}
                                    className="h-9 px-4 text-body"
                                >
                                    <FileCsv className="me-1.5 size-4" />
                                    {isExportingCsv
                                        ? t('actions.exporting')
                                        : t('actions.exportCsv')}
                                </MyButton>
                            </>
                        }
                    />

                    {results.map((result) => {
                        const slidesTableState = {
                            columnVisibility: {
                                subject: !isSlideColumnAllDefault(result.slides, 'subject_name'),
                                module: !isSlideColumnAllDefault(result.slides, 'module_name'),
                                chapter: !isSlideColumnAllDefault(result.slides, 'chapter_name'),
                            },
                        };
                        return (
                            <div key={result.batchId} className="space-y-6">
                                {/* Per-batch heading (multi only) with its own PDF export */}
                                {isMulti && (
                                    <div className="flex flex-col gap-3 border-b border-neutral-200 pb-3 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="rounded-md bg-primary-50 px-2 py-1 text-caption font-semibold uppercase tracking-wide text-primary-500">
                                                {batchTerm}
                                            </span>
                                            <h3 className="text-subtitle font-semibold text-neutral-700">
                                                {blockTitle(result)}
                                            </h3>
                                        </div>
                                        {result.report && exportPdfButton(result)}
                                    </div>
                                )}

                                {result.reportError || !result.report ? (
                                    <div className="flex items-center gap-3 rounded-lg border border-danger-200 bg-danger-50 p-4 text-body text-danger-700">
                                        <Warning className="size-5 shrink-0" />
                                        {t('report.batchLoadFailed', { name: blockTitle(result) })}
                                    </div>
                                ) : (
                                    <>
                                        {/* KPI cards — learner with batch comparison */}
                                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                            <MetricCard
                                                tone="success"
                                                label={t('report.courseCompletedLabel', {
                                                    term: courseTerm,
                                                })}
                                                value={`${formatToTwoDecimalPlaces(
                                                    result.report.learner_progress_report
                                                        ?.percentage_course_completed
                                                )}%`}
                                                sub={`${batchTerm} ${formatToTwoDecimalPlaces(
                                                    result.report.batch_progress_report
                                                        ?.percentage_course_completed
                                                )}%`}
                                                info={METRIC_INFO.courseCompleted}
                                                icon={
                                                    <CheckCircle
                                                        className="size-5"
                                                        weight="duotone"
                                                    />
                                                }
                                            />
                                            <MetricCard
                                                tone="primary"
                                                label={t('report.dailyTimeSpentAvg')}
                                                value={convertMinutesToTimeFormat(
                                                    result.report.learner_progress_report
                                                        ?.avg_time_spent_in_minutes ?? 0
                                                )}
                                                sub={`${batchTerm} ${convertMinutesToTimeFormat(
                                                    result.report.batch_progress_report
                                                        ?.avg_time_spent_in_minutes ?? 0
                                                )}`}
                                                info={METRIC_INFO.timeSpentAvg}
                                                icon={<Clock className="size-5" weight="duotone" />}
                                            />
                                            <MetricCard
                                                tone="warning"
                                                label={t('report.concentrationScoreAvg')}
                                                value={`${formatToTwoDecimalPlaces(
                                                    result.report.learner_progress_report
                                                        ?.percentage_concentration_score || 0
                                                )}%`}
                                                sub={`${batchTerm} ${formatToTwoDecimalPlaces(
                                                    result.report.batch_progress_report
                                                        ?.percentage_concentration_score || 0
                                                )}%`}
                                                info={METRIC_INFO.concentration}
                                                icon={<Brain className="size-5" weight="duotone" />}
                                            />
                                        </div>

                                        {/* Daily Learning Performance */}
                                        <SectionCard
                                            title={t('report.dailyLearningPerformance')}
                                            subtitle={t('report.trackDailyProgress')}
                                            icon={<ChartLineUp className="size-4" />}
                                        >
                                            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                                                <div className="lg:col-span-2">
                                                    <div className="h-auto w-full overflow-visible rounded-lg border border-neutral-200 bg-white">
                                                        <div className="w-full p-4">
                                                            <LineChartComponent
                                                                chartData={transformToChartData(
                                                                    result.report
                                                                )}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="lg:col-span-1">
                                                    <div className="h-full rounded-lg bg-neutral-50 p-4">
                                                        <h4 className="mb-4 text-caption font-semibold uppercase tracking-wide text-neutral-500">
                                                            {t('report.activitySummary')}
                                                        </h4>
                                                        <div className="h-96 overflow-auto">
                                                            <div className="!min-w-full [&_table]:!w-full [&_table]:!min-w-full [&_td]:!whitespace-nowrap [&_th]:!whitespace-nowrap">
                                                                <MyTable
                                                                    data={{
                                                                        content:
                                                                            transformLearnersReport(
                                                                                result.report
                                                                            ),
                                                                        total_pages: 0,
                                                                        page_no: 0,
                                                                        page_size: 10,
                                                                        total_elements: 0,
                                                                        last: true,
                                                                    }}
                                                                    columns={learnersReportColumns}
                                                                    isLoading={false}
                                                                    error={null}
                                                                    currentPage={0}
                                                                    scrollable={true}
                                                                    className="!h-full"
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </SectionCard>

                                        {result.slides && (
                                            <div className="flex flex-col gap-6">
                                                <div className="text-h3 font-semibold text-primary-500">
                                                    {t('report.learningTimeline')}
                                                </div>
                                                {result.slides.map((slide, idx) => (
                                                    <div key={idx} className="flex flex-col gap-1">
                                                        <div className="flex flex-row gap-1 font-semibold">
                                                            {t('report.dateLabel')}{' '}
                                                            <div className="text-primary-500">
                                                                {dayjs(slide.date).format(
                                                                    'DD-MM-YYYY'
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className="!min-w-full overflow-x-auto [&_table]:!w-full [&_table]:!min-w-full [&_td]:!whitespace-nowrap [&_th]:!whitespace-nowrap">
                                                            <MyTable
                                                                data={{
                                                                    content: (
                                                                        slide.slide_details ?? []
                                                                    ).map((detail) => ({
                                                                        study_slide:
                                                                            detail.slide_title,
                                                                        subject:
                                                                            detail.subject_name,
                                                                        module: detail.module_name,
                                                                        chapter:
                                                                            detail.chapter_name,
                                                                        concentration_score: `${detail.concentration_score.toFixed(2)} %`,
                                                                        time_spent:
                                                                            convertMinutesToTimeFormat(
                                                                                parseFloat(
                                                                                    detail.time_spent
                                                                                )
                                                                            ),
                                                                    })),
                                                                    total_pages: 0,
                                                                    page_no: 0,
                                                                    page_size: 10,
                                                                    total_elements: 0,
                                                                    last: true,
                                                                }}
                                                                columns={SlidesColumns}
                                                                isLoading={false}
                                                                error={null}
                                                                currentPage={0}
                                                                tableState={slidesTableState}
                                                            />
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {applied && !isPending && !hasAnyReport && (
                <div className="flex items-center gap-3 rounded-lg border border-danger-200 bg-danger-50 p-4 text-body text-danger-700">
                    <Warning className="size-5 shrink-0" />
                    {t('report.loadFailed')}
                </div>
            )}
        </div>
    );
}
