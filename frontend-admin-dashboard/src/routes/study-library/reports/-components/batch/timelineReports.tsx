import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { ColumnDef } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MyButton } from '@/components/design-system/button';
import {
    CheckCircle,
    Clock,
    Brain,
    ChartLineUp,
    Trophy,
    Export,
    FileCsv,
    CalendarBlank,
    CaretDown,
    ChartBar,
    Warning,
} from '@phosphor-icons/react';
import { buildMetricInfo } from '../metricInfo';
import { ReportHeader, MetricCard, SectionCard } from '../reportUi';
import { LineChartComponent } from './lineChart';
import { MyTable } from '@/components/design-system/table';
import { useQueries } from '@tanstack/react-query';
import { fetchBatchReport, fetchLeaderboardData } from '../../-services/utils';
import { resolveInstituteLogoUrl } from '../live/-utils/instituteLogo';
import { exportBatchLearningPdf } from '../../-utils/exportLearningPdf';
import {
    DailyLearnerTimeSpent,
    BatchReportResponse,
    activityLogColumns,
    leaderBoardColumns,
    LeaderBoardColumnType,
} from '../../-types/types';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import dayjs from 'dayjs';
import { MyPagination } from '@/components/design-system/pagination';
import { formatToTwoDecimalPlaces, convertMinutesToTimeFormat } from '../../-services/helper';
import { usePacageDetails } from '../../-store/usePacageDetails';
import { toast } from 'sonner';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { cn } from '@/lib/utils';
import DateRangeFilter from '@/components/design-system/date-range-filter';
import BatchMultiSelect, { useBatchLookup, type BatchOption } from '../batchMultiSelect';
import { buildReportCsv, csvFileName, downloadCsv, num, csvDate } from '../../-utils/reportCsv';

const LEADERBOARD_PAGE_SIZE = 10;
/** One page big enough for a whole batch — the CSV carries the full leaderboard. */
const LEADERBOARD_EXPORT_PAGE_SIZE = 1000;

const buildFormSchema = (t: TFunction) =>
    z
        .object({
            batches: z.array(z.string()).min(1, t('form.batchRequired')),
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

interface LeaderBoardData {
    daily_avg_time: number;
    avg_concentration: number;
    rank: number;
    total_time: number;
    user_id: string;
    email: string;
    full_name: string;
}

interface LeaderboardPage {
    content: LeaderBoardData[];
    totalPages: number;
}

interface AppliedFilters {
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

/** Everything one batch contributes to the multi-batch view. */
interface BatchResult {
    batchId: string;
    option: BatchOption | undefined;
    report: BatchReportResponse | undefined;
    reportError: boolean;
    leaderboard: LeaderBoardData[];
    leaderboardTotalPages: number;
    leaderboardLoading: boolean;
}

interface ComparisonRow {
    batch: string;
    completed: string;
    dailyTime: string;
    concentration: string;
}

interface TimelineReportsProps {
    /**
     * When rendered inside a batch-scoped surface (e.g. Course Details → Reports),
     * the batch is already known — the batch picker is hidden and the report is
     * generated for this package session directly.
     */
    fixedPackageSessionId?: string;
    /** Course id backing `fixedPackageSessionId`, used only to title the report. */
    fixedCourseId?: string;
}

const convertFormat = (data: DailyLearnerTimeSpent[] | undefined) =>
    (data ?? []).map((item) => ({
        date: dayjs(item.activity_date).format('DD/MM/YYYY'),
        timeSpent: convertMinutesToTimeFormat(item.avg_daily_time_minutes),
    }));

const convertChartData = (data: DailyLearnerTimeSpent[] | undefined) =>
    (data ?? []).map((item) => ({
        activity_date: item.activity_date,
        avg_daily_time_minutes: item.avg_daily_time_minutes / 60,
    }));

const transformToLeaderBoard = (data: LeaderBoardData[]): LeaderBoardColumnType[] =>
    data.map((item) => ({
        rank: item.rank.toString(),
        name: item.full_name,
        score: `${formatToTwoDecimalPlaces(item.avg_concentration.toString())} %`,
        average: convertMinutesToTimeFormat(item.daily_avg_time),
        totalTime: convertMinutesToTimeFormat(item.total_time),
    }));

export default function TimelineReports({
    fixedPackageSessionId,
    fixedCourseId,
}: TimelineReportsProps = {}) {
    const { t } = useTranslation([
        'studyLibraryBatchTimelineReports',
        'studyLibraryExportLearningPdf',
        'studyLibraryReportsMetricInfo',
    ]);
    const METRIC_INFO = buildMetricInfo(t);
    const isBatchFixed = Boolean(fixedPackageSessionId);
    const { getCourseFromPackage } = useInstituteDetailsStore();
    const { setPacageSessionId } = usePacageDetails();
    const courseList = getCourseFromPackage();
    const batchLookup = useBatchLookup();
    const instituteDetails = useInstituteDetailsStore((s) => s.instituteDetails);
    const batchTerm = getTerminology(ContentTerms.Batch, SystemTerms.Batch);
    const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);

    const [applied, setApplied] = useState<AppliedFilters | null>(null);
    /** Leaderboard page per batch — each block pages independently. */
    const [leaderboardPages, setLeaderboardPages] = useState<Record<string, number>>({});
    const [isExportingPdf, setIsExportingPdf] = useState<string | null>(null);
    const [isExportingCsv, setIsExportingCsv] = useState(false);
    // Fixed-batch mode: the date filter collapses away once the default 7-day
    // report has been generated, so the report itself gets the vertical space.
    const [showDateFilter, setShowDateFilter] = useState(false);
    const hasAutoGenerated = useRef(false);

    const {
        handleSubmit,
        setValue,
        watch,
        clearErrors,
        formState: { errors },
    } = useForm<FormValues>({
        resolver: zodResolver(buildFormSchema(t)),
        defaultValues: {
            // In fixed-batch mode the picker is hidden; seed the batch so the
            // schema's "required" check passes — only the date range is user-supplied.
            batches: fixedPackageSessionId ? [fixedPackageSessionId] : [],
            startDate: '',
            endDate: '',
        },
    });

    const selectedBatches = watch('batches');
    const startDate = watch('startDate');
    const endDate = watch('endDate');

    // Fixed-batch mode: DateRangeFilter's "7 Days" default populates the form on
    // mount — fire the report once so the tab lands with data already loaded.
    useEffect(() => {
        if (!isBatchFixed || hasAutoGenerated.current) return;
        if (!startDate || !endDate) return;
        hasAutoGenerated.current = true;
        handleSubmit(onSubmit)();
    }, [isBatchFixed, startDate, endDate]);

    const handleDateRangeChange = (res: { startDate: string; endDate: string } | null) => {
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
    };

    const onSubmit = (data: FormValues) => {
        setLeaderboardPages({});
        setApplied({
            batchIds: data.batches,
            startDate: data.startDate,
            endDate: data.endDate,
            runId: Date.now(),
        });
        // Other report tabs read the last-used batch from this store; keep the
        // first selection there so their behaviour is unchanged.
        setPacageSessionId(data.batches[0] ?? '');
    };

    // ── Data: one report + one leaderboard page per selected batch ───────────
    const reportQueries = useQueries({
        queries: (applied?.batchIds ?? []).map((batchId) => ({
            queryKey: [
                'batchTimelineReport',
                batchId,
                applied?.startDate,
                applied?.endDate,
                applied?.runId,
            ],
            queryFn: () =>
                fetchBatchReport({
                    start_date: applied?.startDate ?? '',
                    end_date: applied?.endDate ?? '',
                    package_session_id: batchId,
                }) as Promise<BatchReportResponse>,
            staleTime: 5 * 60 * 1000,
        })),
    });

    const leaderboardQueries = useQueries({
        queries: (applied?.batchIds ?? []).map((batchId) => ({
            queryKey: [
                'batchTimelineLeaderboard',
                batchId,
                applied?.startDate,
                applied?.endDate,
                applied?.runId,
                leaderboardPages[batchId] ?? 0,
            ],
            queryFn: () =>
                fetchLeaderboardData({
                    body: {
                        start_date: applied?.startDate ?? '',
                        end_date: applied?.endDate ?? '',
                        package_session_id: batchId,
                    },
                    param: {
                        pageNo: leaderboardPages[batchId] ?? 0,
                        pageSize: LEADERBOARD_PAGE_SIZE,
                    },
                }) as Promise<LeaderboardPage>,
            staleTime: 5 * 60 * 1000,
        })),
    });

    const isLoading = reportQueries.some((q) => q.isLoading);
    const resultsKey = reportQueries
        .map((q) => `${q.status}:${q.dataUpdatedAt}`)
        .concat(leaderboardQueries.map((q) => `${q.status}:${q.dataUpdatedAt}`))
        .join('|');

    const results = useMemo<BatchResult[]>(
        () =>
            (applied?.batchIds ?? []).map((batchId, index) => ({
                batchId,
                option: batchLookup.get(batchId),
                report: reportQueries[index]?.data,
                reportError: Boolean(reportQueries[index]?.isError),
                leaderboard: leaderboardQueries[index]?.data?.content ?? [],
                leaderboardTotalPages: leaderboardQueries[index]?.data?.totalPages ?? 0,
                leaderboardLoading: Boolean(leaderboardQueries[index]?.isFetching),
            })),
        // The query arrays are recreated every render; key off the resolved values.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [applied, batchLookup, resultsKey]
    );

    const isMulti = (applied?.batchIds.length ?? 0) > 1;
    const hasAnyReport = results.some((r) => r.report);

    /** Title for one batch: the course in single mode, the full batch label otherwise. */
    const blockTitle = (result: BatchResult) => {
        if (isBatchFixed) {
            return (
                courseList.find((c) => c.id === fixedCourseId)?.name || result.option?.label || ''
            );
        }
        return result.option?.label || result.option?.courseName || '';
    };

    const dateRangeLabel = applied
        ? `${dayjs(applied.startDate).format('DD MMM YYYY')} — ${dayjs(applied.endDate).format('DD MMM YYYY')}`
        : '';

    // ── Exports ──────────────────────────────────────────────────────────────
    const handleExportPdf = async (result: BatchResult) => {
        if (!result.report || !applied) return;
        setIsExportingPdf(result.batchId);
        try {
            const logoUrl = await resolveInstituteLogoUrl(instituteDetails?.institute_logo_file_id);
            await exportBatchLearningPdf(
                {
                    instituteName: instituteDetails?.institute_name || 'Vacademy',
                    logoUrl,
                    courseName: isBatchFixed
                        ? courseList.find((c) => c.id === fixedCourseId)?.name || ''
                        : result.option?.label || '',
                    dateRange: dateRangeLabel,
                },
                result.report,
                result.leaderboard.map((l) => ({
                    rank: l.rank,
                    full_name: l.full_name,
                    avg_concentration: l.avg_concentration,
                    daily_avg_time: l.daily_avg_time,
                    total_time: l.total_time,
                })),
                t
            );
            toast.success(t('toast.exportSuccess'));
        } catch {
            toast.error(t('toast.exportFailed'));
        } finally {
            setIsExportingPdf(null);
        }
    };

    const handleExportCsv = async () => {
        if (!applied || !hasAnyReport) return;
        setIsExportingCsv(true);
        try {
            // The on-screen leaderboard is one page; the file carries all of it.
            const fullLeaderboards = await Promise.all(
                results.map(
                    (r) =>
                        fetchLeaderboardData({
                            body: {
                                start_date: applied.startDate,
                                end_date: applied.endDate,
                                package_session_id: r.batchId,
                            },
                            param: { pageNo: 0, pageSize: LEADERBOARD_EXPORT_PAGE_SIZE },
                        }).then((page: LeaderboardPage) => page?.content ?? []) as Promise<
                            LeaderBoardData[]
                        >
                )
            );
            const label = (r: BatchResult) => blockTitle(r);
            const csv = buildReportCsv([
                {
                    title: t('csv.summaryTitle'),
                    headers: [
                        batchTerm,
                        courseTerm,
                        t('csv.startDate'),
                        t('csv.endDate'),
                        t('csv.courseCompleted', { term: courseTerm }),
                        t('csv.dailyTimeMin'),
                        t('csv.concentration'),
                    ],
                    rows: results
                        .filter((r) => r.report)
                        .map((r) => [
                            label(r),
                            r.option?.courseName ?? '',
                            applied.startDate,
                            applied.endDate,
                            num(r.report?.percentage_course_completed),
                            num(r.report?.avg_time_spent_in_minutes),
                            num(r.report?.percentage_concentration_score),
                        ]),
                },
                {
                    title: t('csv.dailyTitle'),
                    headers: [batchTerm, t('csv.date'), t('csv.avgDailyTimeMin')],
                    rows: results.flatMap((r) =>
                        (r.report?.daily_time_spent ?? []).map((d) => [
                            label(r),
                            csvDate(d.activity_date),
                            num(d.avg_daily_time_minutes),
                        ])
                    ),
                },
                {
                    title: t('csv.leaderboardTitle'),
                    headers: [
                        batchTerm,
                        t('csv.rank'),
                        t('csv.name'),
                        t('csv.email'),
                        t('csv.concentration'),
                        t('csv.dailyTimeMin'),
                        t('csv.totalTimeMin'),
                    ],
                    rows: results.flatMap((r, index) =>
                        (fullLeaderboards[index] ?? []).map((l) => [
                            label(r),
                            l.rank,
                            l.full_name,
                            l.email,
                            num(l.avg_concentration),
                            num(l.daily_avg_time),
                            num(l.total_time),
                        ])
                    ),
                },
            ]);
            downloadCsv(
                csvFileName(
                    t('csv.fileStem'),
                    isMulti ? `${results.length}-${batchTerm}` : label(results[0]!),
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

    // ── Comparison table (multi-batch only) ─────────────────────────────────
    const comparisonColumns = useMemo<ColumnDef<ComparisonRow>[]>(
        () => [
            { accessorKey: 'batch', header: batchTerm },
            {
                accessorKey: 'completed',
                header: t('report.courseCompletedLabel', { term: courseTerm }),
            },
            { accessorKey: 'dailyTime', header: t('report.dailyTimeSpentAvg') },
            { accessorKey: 'concentration', header: t('report.concentrationScoreAvg') },
        ],
        [t, batchTerm, courseTerm]
    );
    const comparisonData = {
        content: results
            .filter((r) => r.report)
            .map((r) => ({
                batch: blockTitle(r),
                completed: `${formatToTwoDecimalPlaces(r.report?.percentage_course_completed)}%`,
                dailyTime: convertMinutesToTimeFormat(r.report?.avg_time_spent_in_minutes ?? 0),
                concentration: `${formatToTwoDecimalPlaces(r.report?.percentage_concentration_score || 0)}%`,
            })),
        total_pages: 0,
        page_no: 0,
        page_size: results.length,
        total_elements: results.length,
        last: true,
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

    const exportCsvButton = (
        <MyButton
            buttonType="secondary"
            onClick={handleExportCsv}
            disable={isExportingCsv}
            className="h-9 px-4 text-body"
        >
            <FileCsv className="me-1.5 size-4" />
            {isExportingCsv ? t('actions.exporting') : t('actions.exportCsv')}
        </MyButton>
    );

    return (
        <div className="space-y-6">
            {/* Filter card */}
            <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    {/* Batch picker — hidden when the parent already scopes the batch */}
                    {!isBatchFixed && (
                        <BatchMultiSelect
                            selected={selectedBatches}
                            onChange={(ids) => {
                                setValue('batches', ids);
                                if (ids.length) clearErrors('batches');
                            }}
                            error={errors.batches?.message}
                        />
                    )}

                    {/* Dates and Generate Button.
                        Batch-scoped: collapsed to a one-line summary, expandable to re-pick. */}
                    {isBatchFixed ? (
                        <div className="space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <CalendarBlank className="size-4 text-neutral-400" />
                                    <span className="text-caption text-neutral-500">
                                        {t('range.label')}
                                    </span>
                                    <span className="text-body font-medium text-neutral-700">
                                        {startDate && endDate
                                            ? `${dayjs(startDate).format('DD MMM YYYY')} — ${dayjs(endDate).format('DD MMM YYYY')}`
                                            : t('range.last7Days')}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setShowDateFilter((open) => !open)}
                                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-caption font-medium text-primary-500 hover:bg-primary-50"
                                    >
                                        {showDateFilter ? t('range.hide') : t('range.change')}
                                        <CaretDown
                                            className={cn(
                                                'size-3 transition-transform',
                                                showDateFilter && 'rotate-180'
                                            )}
                                        />
                                    </button>
                                </div>
                                <MyButton
                                    type="submit"
                                    buttonType="primary"
                                    className="h-9 px-4 text-body font-medium"
                                >
                                    {t('actions.generateReport')}
                                </MyButton>
                            </div>
                            {/* Kept mounted (only visually hidden) so DateRangeFilter's
                                "7 Days" default still seeds the form on first render. */}
                            <div className={cn(!showDateFilter && 'hidden')}>
                                <DateRangeFilter
                                    defaultFilter="7 Days"
                                    onChange={handleDateRangeChange}
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="flex w-full flex-col gap-4 sm:flex-row sm:items-end">
                            <div className="flex-1">
                                <DateRangeFilter onChange={handleDateRangeChange} />
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
                    )}

                    {/* Error Messages (the batch error is shown under its own control) */}
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

            {isLoading && <DashboardLoader />}

            {applied && !isLoading && hasAnyReport && (
                <div className="space-y-6">
                    {/* Report header — course in single mode, "N batches" otherwise */}
                    <ReportHeader
                        title={
                            isMulti
                                ? t('report.multiBatchTitle', {
                                      count: results.length,
                                      term: batchTerm,
                                  })
                                : blockTitle(results[0]!)
                        }
                        chips={
                            <>
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
                                {!isMulti && results[0]?.report && exportPdfButton(results[0])}
                                {exportCsvButton}
                            </>
                        }
                    />

                    {/* Side-by-side comparison of the selected batches */}
                    {isMulti && (
                        <SectionCard
                            title={t('report.comparisonTitle', { term: batchTerm })}
                            subtitle={t('report.comparisonSubtitle')}
                            icon={<ChartBar className="size-4" />}
                        >
                            <div className="w-full overflow-hidden">
                                <MyTable
                                    data={comparisonData}
                                    columns={comparisonColumns}
                                    isLoading={false}
                                    error={null}
                                    currentPage={0}
                                    className="w-full !min-w-full [&_table]:!w-full [&_table]:!min-w-full [&_td]:!px-4 [&_th]:!px-4"
                                />
                            </div>
                        </SectionCard>
                    )}

                    {results.map((result) => (
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
                                    {/* KPI cards */}
                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                        <MetricCard
                                            tone="success"
                                            label={t('report.courseCompletedLabel', {
                                                term: courseTerm,
                                            })}
                                            value={`${formatToTwoDecimalPlaces(result.report.percentage_course_completed)}%`}
                                            sub={t('report.acrossBatch')}
                                            info={METRIC_INFO.courseCompleted}
                                            icon={
                                                <CheckCircle className="size-5" weight="duotone" />
                                            }
                                        />
                                        <MetricCard
                                            tone="primary"
                                            label={t('report.dailyTimeSpentAvg')}
                                            value={convertMinutesToTimeFormat(
                                                result.report.avg_time_spent_in_minutes ?? 0
                                            )}
                                            info={METRIC_INFO.timeSpentAvg}
                                            icon={<Clock className="size-5" weight="duotone" />}
                                        />
                                        <MetricCard
                                            tone="warning"
                                            label={t('report.concentrationScoreAvg')}
                                            value={`${formatToTwoDecimalPlaces(result.report.percentage_concentration_score || 0)}%`}
                                            info={METRIC_INFO.concentration}
                                            icon={<Brain className="size-5" weight="duotone" />}
                                        />
                                    </div>

                                    {/* Daily learning performance */}
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
                                                            chartData={convertChartData(
                                                                result.report.daily_time_spent
                                                            )}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="lg:col-span-1">
                                                <div className="rounded-lg bg-neutral-50 p-4">
                                                    <h4 className="mb-4 text-caption font-semibold uppercase tracking-wide text-neutral-500">
                                                        {t('report.activitySummary')}
                                                    </h4>
                                                    <div className="h-96 overflow-auto">
                                                        <div className="!min-w-full [&_table]:!w-full [&_table]:!min-w-full [&_td]:!whitespace-nowrap [&_th]:!whitespace-nowrap">
                                                            <MyTable
                                                                data={{
                                                                    content: convertFormat(
                                                                        result.report
                                                                            .daily_time_spent
                                                                    ),
                                                                    total_pages: 0,
                                                                    page_no: 0,
                                                                    page_size: 10,
                                                                    total_elements: 0,
                                                                    last: false,
                                                                }}
                                                                columns={activityLogColumns}
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

                                    {/* Leaderboard */}
                                    <SectionCard
                                        title={t('report.leaderboard')}
                                        subtitle={t('report.topPerformingStudents')}
                                        icon={<Trophy className="size-4" />}
                                        info={METRIC_INFO.leaderboard}
                                    >
                                        <div className="w-full overflow-hidden">
                                            <MyTable
                                                data={{
                                                    content: transformToLeaderBoard(
                                                        result.leaderboard
                                                    ),
                                                    total_pages: result.leaderboardTotalPages,
                                                    page_no: leaderboardPages[result.batchId] ?? 0,
                                                    page_size: LEADERBOARD_PAGE_SIZE,
                                                    total_elements: 0,
                                                    last: false,
                                                }}
                                                columns={leaderBoardColumns}
                                                isLoading={result.leaderboardLoading}
                                                error={null}
                                                currentPage={0}
                                                className="w-full !min-w-full [&_table]:!w-full [&_table]:!min-w-full [&_tbody]:!w-full [&_td]:!px-4 [&_th]:!px-4 [&_thead]:!w-full [&_tr]:!w-full"
                                            />
                                        </div>
                                        <div className="mt-6 flex justify-center">
                                            <MyPagination
                                                currentPage={leaderboardPages[result.batchId] ?? 0}
                                                totalPages={result.leaderboardTotalPages}
                                                onPageChange={(page) =>
                                                    setLeaderboardPages((prev) => ({
                                                        ...prev,
                                                        [result.batchId]: page,
                                                    }))
                                                }
                                            />
                                        </div>
                                    </SectionCard>
                                </>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {applied && !isLoading && !hasAnyReport && (
                <div className="flex items-center gap-3 rounded-lg border border-danger-200 bg-danger-50 p-4 text-body text-danger-700">
                    <Warning className="size-5 shrink-0" />
                    {t('report.loadFailed')}
                </div>
            )}
        </div>
    );
}
