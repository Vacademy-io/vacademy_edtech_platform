import { useMemo, useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Link } from '@tanstack/react-router';
import dayjs from 'dayjs';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    CalendarCheck,
    Presentation,
    Timer,
    ChatsCircle,
    Export,
    FileCsv,
    ArrowSquareOut,
    Warning,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyTable } from '@/components/design-system/table';
import { MyPagination } from '@/components/design-system/pagination';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { resolveInstituteLogoUrl } from './-utils/instituteLogo';
import LiveReportFilterForm, { AppliedLiveBatch, AppliedLiveFilters } from './liveReportFilterForm';
import { useLiveBatchReports } from './-services/liveReportApi';
import { BatchLiveSummary, computeBatchSummary, formatDuration } from './-utils/liveCompute';
import { exportBatchLivePdf } from './-utils/exportLivePdf';
import { LiveAttendanceChart } from './liveAttendanceChart';
import { MetricCard, SectionCard } from './liveUiBits';
import { buildReportCsv, csvFileName, downloadCsv, num, csvDate } from '../../-utils/reportCsv';

const LB_PAGE_SIZE = 10;

interface EngMeta {
    talkTimeMin: number;
    chats: number;
    polls: number;
    raiseHand: number;
    emojis: number;
}

/**
 * Engagement score (0–100) with the raw interactions that produced it shown
 * inline underneath — talk time, chats, spoken turns, polls, raise-hands.
 * Only non-zero signals are listed so the cell stays compact.
 */
function EngagementCell({ score, meta }: { score: number; meta: EngMeta }) {
    const { t } = useTranslation('studyLibraryBatchLiveReport');
    const parts: string[] = [];
    if (meta.talkTimeMin > 0) parts.push(t('engagement.talkTime', { count: meta.talkTimeMin }));
    if (meta.chats > 0) parts.push(t('engagement.chats', { count: meta.chats }));
    if (meta.polls > 0) parts.push(t('engagement.polls', { count: meta.polls }));
    if (meta.raiseHand > 0) parts.push(t('engagement.raiseHand', { count: meta.raiseHand }));
    if (meta.emojis > 0) parts.push(t('engagement.emojis', { count: meta.emojis }));

    return (
        <div className="flex flex-col gap-0.5">
            <span className="text-body font-semibold text-neutral-700">{score}</span>
            {parts.length > 0 ? (
                <span className="text-caption leading-snug text-neutral-400">
                    {parts.join(' · ')}
                </span>
            ) : (
                <span className="text-caption text-neutral-300">{t('engagement.none')}</span>
            )}
        </div>
    );
}

interface PerClassRow {
    date: string;
    title: string;
    present: number;
    absent: number;
    attendance: string;
    duration: string;
    engagement: number;
}

function buildPerClassColumns(t: TFunction): ColumnDef<PerClassRow>[] {
    return [
        { accessorKey: 'date', header: t('table.date') },
        { accessorKey: 'title', header: t('table.class') },
        { accessorKey: 'present', header: t('table.present') },
        { accessorKey: 'absent', header: t('table.absent') },
        { accessorKey: 'attendance', header: t('table.attendance') },
        { accessorKey: 'duration', header: t('table.avgDuration') },
        { accessorKey: 'engagement', header: t('table.engagement') },
    ];
}

interface LeaderRow {
    rank: number;
    name: string;
    attendance: string;
    classes: string;
    duration: string;
    engagement: number;
    engMeta: EngMeta;
}

function buildLeaderColumns(t: TFunction): ColumnDef<LeaderRow>[] {
    return [
        { accessorKey: 'rank', header: t('table.rank') },
        { accessorKey: 'name', header: t('table.name') },
        { accessorKey: 'attendance', header: t('table.attendance') },
        { accessorKey: 'classes', header: t('table.classesAttended') },
        { accessorKey: 'duration', header: t('table.avgDuration') },
        {
            accessorKey: 'engagement',
            header: t('table.engagement'),
            cell: ({ row }) => (
                <EngagementCell score={row.original.engagement} meta={row.original.engMeta} />
            ),
        },
    ];
}

interface ComparisonRow {
    batch: string;
    learners: number;
    classes: number;
    attendance: string;
    duration: string;
    engagement: number;
}

function buildComparisonColumns(t: TFunction, batchTerm: string): ColumnDef<ComparisonRow>[] {
    return [
        { accessorKey: 'batch', header: batchTerm },
        { accessorKey: 'learners', header: t('comparison.learners') },
        { accessorKey: 'classes', header: t('metrics.classesHeld') },
        { accessorKey: 'attendance', header: t('metrics.avgAttendance') },
        { accessorKey: 'duration', header: t('metrics.avgDurationPerClass') },
        { accessorKey: 'engagement', header: t('metrics.avgEngagement') },
    ];
}

/** One batch's slice of the report. */
interface BatchLiveResult {
    batch: AppliedLiveBatch;
    summary: BatchLiveSummary | null;
    isError: boolean;
}

export default function BatchLiveReport() {
    const { t } = useTranslation('studyLibraryBatchLiveReport');
    const { instituteDetails } = useInstituteDetailsStore();
    const batchTerm = getTerminology(ContentTerms.Batch, SystemTerms.Batch);
    const [applied, setApplied] = useState<AppliedLiveFilters | null>(null);
    /** Leaderboard page per batch — each block pages independently. */
    const [lbPages, setLbPages] = useState<Record<string, number>>({});
    const [exporting, setExporting] = useState<string | null>(null);
    const [exportingCsv, setExportingCsv] = useState(false);
    const perClassColumns = useMemo(() => buildPerClassColumns(t), [t]);
    const leaderColumns = useMemo(() => buildLeaderColumns(t), [t]);
    const comparisonColumns = useMemo(() => buildComparisonColumns(t, batchTerm), [t, batchTerm]);

    const queries = useLiveBatchReports(
        applied?.batches.map((b) => b.packageSessionId) ?? [],
        applied?.startDate || '',
        applied?.endDate || '',
        !!applied,
        applied?.runId
    );
    const isFetching = queries.some((q) => q.isFetching);
    const resultsKey = queries.map((q) => `${q.status}:${q.dataUpdatedAt}`).join('|');
    const results = useMemo<BatchLiveResult[]>(
        () =>
            (applied?.batches ?? []).map((batch, index) => ({
                batch,
                summary: queries[index]?.data ? computeBatchSummary(queries[index]!.data!) : null,
                isError: Boolean(queries[index]?.isError),
            })),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [applied, resultsKey]
    );
    const isMulti = (applied?.batches.length ?? 0) > 1;
    const allFailed = results.length > 0 && results.every((r) => r.isError);
    const withData = results.filter((r) => r.summary && r.summary.totalClassesHeld > 0);
    const hasData = withData.length > 0;

    const fmtDate = (d: string | null) =>
        d && dayjs(d).isValid() ? dayjs(d).format('DD MMM YYYY') : '—';

    const blockTitle = (batch: AppliedLiveBatch) => batch.label || batch.courseName;

    const perClassTable = (summary: BatchLiveSummary) => ({
        content: summary.perClass.map((c) => ({
            date: fmtDate(c.date),
            title: c.title,
            present: c.present,
            absent: c.total - c.present,
            attendance: `${c.attendancePct.toFixed(0)}%`,
            duration: formatDuration(c.avgDurationMinutes, t),
            engagement: c.avgEngagementIndex,
        })),
        total_pages: 1,
        page_no: 0,
        page_size: summary.perClass.length,
        total_elements: summary.perClass.length,
        last: true,
    });

    const leaderTable = (summary: BatchLiveSummary, page: number) => {
        const totalPages = Math.ceil(summary.leaderboard.length / LB_PAGE_SIZE);
        return {
            content: summary.leaderboard
                .slice(page * LB_PAGE_SIZE, page * LB_PAGE_SIZE + LB_PAGE_SIZE)
                .map((r) => ({
                    rank: r.rank,
                    name: r.fullName,
                    attendance: `${r.attendancePercentage.toFixed(1)}%`,
                    classes: `${r.attended}/${r.total}`,
                    duration: formatDuration(r.avgDurationMinutes, t),
                    engagement: r.engagementIndex,
                    engMeta: {
                        talkTimeMin: Math.round(r.engagement.talkTimeSeconds / 60),
                        chats: r.engagement.chats,
                        polls: r.engagement.pollVotes,
                        raiseHand: r.engagement.raiseHand,
                        emojis: r.engagement.emojis,
                    },
                })),
            total_pages: totalPages,
            page_no: page,
            page_size: LB_PAGE_SIZE,
            total_elements: summary.leaderboard.length,
            last: page >= totalPages - 1,
        };
    };

    const comparisonTable = {
        content: withData.map((r) => ({
            batch: blockTitle(r.batch),
            learners: r.summary!.learnerCount,
            classes: r.summary!.totalClassesHeld,
            attendance: `${r.summary!.avgAttendancePct.toFixed(1)}%`,
            duration: formatDuration(r.summary!.avgDurationMinutes, t),
            engagement: r.summary!.avgEngagementIndex,
        })),
        total_pages: 1,
        page_no: 0,
        page_size: withData.length,
        total_elements: withData.length,
        last: true,
    };

    const handleExport = async (result: BatchLiveResult) => {
        if (!result.summary || !applied) return;
        setExporting(result.batch.packageSessionId);
        try {
            const logoUrl = await resolveInstituteLogoUrl(instituteDetails?.institute_logo_file_id);
            await exportBatchLivePdf(
                {
                    instituteName: instituteDetails?.institute_name || 'Vacademy',
                    logoUrl,
                    courseName: result.batch.courseName,
                    batchLabel: result.batch.batchLabel,
                    dateRange: `${fmtDate(applied.startDate)} — ${fmtDate(applied.endDate)}`,
                    generatedOn: t('export.generatedOn', {
                        date: dayjs().format('DD MMM YYYY, HH:mm'),
                    }),
                },
                result.summary
            );
            toast.success(t('export.exportSuccess'));
        } catch {
            toast.error(t('export.exportFailed'));
        } finally {
            setExporting(null);
        }
    };

    const handleExportCsv = () => {
        if (!applied || !hasData) return;
        setExportingCsv(true);
        try {
            const csv = buildReportCsv([
                {
                    title: t('csv.summaryTitle'),
                    headers: [
                        batchTerm,
                        t('csv.startDate'),
                        t('csv.endDate'),
                        t('comparison.learners'),
                        t('metrics.classesHeld'),
                        t('csv.avgAttendancePct'),
                        t('csv.avgDurationMin'),
                        t('csv.avgEngagementIndex'),
                    ],
                    rows: withData.map((r) => [
                        blockTitle(r.batch),
                        applied.startDate,
                        applied.endDate,
                        r.summary!.learnerCount,
                        r.summary!.totalClassesHeld,
                        num(r.summary!.avgAttendancePct),
                        num(r.summary!.avgDurationMinutes),
                        r.summary!.avgEngagementIndex,
                    ]),
                },
                {
                    title: t('csv.classesTitle'),
                    headers: [
                        batchTerm,
                        t('table.date'),
                        t('table.class'),
                        t('table.present'),
                        t('table.absent'),
                        t('csv.unmarked'),
                        t('csv.invited'),
                        t('csv.attendancePct'),
                        t('csv.avgDurationMin'),
                        t('csv.avgEngagementIndex'),
                    ],
                    rows: withData.flatMap((r) =>
                        r.summary!.perClass.map((c) => [
                            blockTitle(r.batch),
                            csvDate(c.date),
                            c.title,
                            c.present,
                            c.absent,
                            c.unmarked,
                            c.total,
                            num(c.attendancePct),
                            num(c.avgDurationMinutes),
                            c.avgEngagementIndex,
                        ])
                    ),
                },
                {
                    title: t('csv.leaderboardTitle'),
                    headers: [
                        batchTerm,
                        t('table.rank'),
                        t('table.name'),
                        t('csv.attendancePct'),
                        t('csv.attended'),
                        t('csv.totalClasses'),
                        t('csv.avgDurationMin'),
                        t('csv.engagementIndex'),
                        t('csv.engagementScore'),
                        t('csv.talkTimeMin'),
                        t('csv.chats'),
                        t('csv.polls'),
                        t('csv.raiseHands'),
                        t('csv.emojis'),
                    ],
                    rows: withData.flatMap((r) =>
                        r.summary!.leaderboard.map((l) => [
                            blockTitle(r.batch),
                            l.rank,
                            l.fullName,
                            num(l.attendancePercentage),
                            l.attended,
                            l.total,
                            num(l.avgDurationMinutes),
                            l.engagementIndex,
                            l.engagementScore,
                            num(l.engagement.talkTimeSeconds / 60),
                            l.engagement.chats,
                            l.engagement.pollVotes,
                            l.engagement.raiseHand,
                            l.engagement.emojis,
                        ])
                    ),
                },
            ]);
            downloadCsv(
                csvFileName(
                    t('csv.fileStem'),
                    isMulti ? `${withData.length}-${batchTerm}` : blockTitle(withData[0]!.batch),
                    applied.startDate,
                    applied.endDate
                ),
                csv
            );
            toast.success(t('export.csvExportSuccess'));
        } catch {
            toast.error(t('export.csvExportFailed'));
        } finally {
            setExportingCsv(false);
        }
    };

    const handleApply = (filters: AppliedLiveFilters) => {
        setLbPages({});
        setApplied(filters);
    };

    const exportPdfButton = (result: BatchLiveResult) => (
        <MyButton
            buttonType="primary"
            onClick={() => handleExport(result)}
            disable={exporting === result.batch.packageSessionId}
            className="h-9 px-3 text-body"
        >
            <Export className="me-1.5 size-4" />
            {exporting === result.batch.packageSessionId
                ? t('actions.exporting')
                : t('actions.exportPdf')}
        </MyButton>
    );

    return (
        <div className="space-y-6">
            <LiveReportFilterForm submitting={isFetching} onApply={handleApply} />

            {isFetching && <DashboardLoader />}

            {allFailed && !isFetching && (
                <div className="rounded-lg border border-danger-200 bg-danger-50 p-6 text-body text-danger-700">
                    {t('errors.loadFailed')}
                </div>
            )}

            {applied && !isFetching && !allFailed && !hasData && (
                <div className="rounded-lg border border-neutral-200 bg-white p-10 text-center shadow-sm">
                    <p className="text-subtitle font-semibold text-neutral-700">
                        {t('emptyState.title')}
                    </p>
                    <p className="mt-1 text-body text-neutral-500">{t('emptyState.description')}</p>
                </div>
            )}

            {applied && hasData && !isFetching && (
                <div className="space-y-6">
                    {/* Report header */}
                    <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="space-y-2">
                                <h3 className="text-subtitle font-semibold text-primary-500">
                                    {isMulti
                                        ? t('multiBatchTitle', {
                                              count: results.length,
                                              term: batchTerm,
                                          })
                                        : results[0]?.batch.courseName}
                                </h3>
                                <div className="flex flex-wrap items-center gap-2 text-body">
                                    {!isMulti && results[0]?.batch.batchLabel && (
                                        <span className="rounded-md bg-primary-50 px-2 py-1 text-caption font-medium text-neutral-700">
                                            {results[0].batch.batchLabel}
                                        </span>
                                    )}
                                    <span className="text-neutral-500">
                                        {fmtDate(applied.startDate)} — {fmtDate(applied.endDate)}
                                    </span>
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <Link to="/study-library/attendance-tracker">
                                    <MyButton buttonType="secondary" className="h-9 px-3 text-body">
                                        <ArrowSquareOut className="me-1.5 size-4" />
                                        {t('actions.attendanceTracker')}
                                    </MyButton>
                                </Link>
                                <MyButton
                                    buttonType="secondary"
                                    onClick={handleExportCsv}
                                    disable={exportingCsv}
                                    className="h-9 px-3 text-body"
                                >
                                    <FileCsv className="me-1.5 size-4" />
                                    {exportingCsv ? t('actions.exporting') : t('actions.exportCsv')}
                                </MyButton>
                                {!isMulti && results[0]?.summary && exportPdfButton(results[0])}
                            </div>
                        </div>
                    </div>

                    {/* Side-by-side comparison of the selected batches */}
                    {isMulti && (
                        <SectionCard
                            title={t('comparison.title', { term: batchTerm })}
                            subtitle={t('comparison.subtitle')}
                        >
                            <MyTable
                                data={comparisonTable}
                                columns={comparisonColumns}
                                isLoading={false}
                                error={null}
                                currentPage={0}
                            />
                        </SectionCard>
                    )}

                    {results.map((result) => {
                        const summary = result.summary;
                        const page = lbPages[result.batch.packageSessionId] ?? 0;
                        const lbTotalPages = summary
                            ? Math.ceil(summary.leaderboard.length / LB_PAGE_SIZE)
                            : 0;
                        return (
                            <div key={result.batch.packageSessionId} className="space-y-6">
                                {isMulti && (
                                    <div className="flex flex-col gap-3 border-b border-neutral-200 pb-3 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="rounded-md bg-primary-50 px-2 py-1 text-caption font-semibold uppercase tracking-wide text-primary-500">
                                                {batchTerm}
                                            </span>
                                            <h3 className="text-subtitle font-semibold text-neutral-700">
                                                {blockTitle(result.batch)}
                                            </h3>
                                        </div>
                                        {summary &&
                                            summary.totalClassesHeld > 0 &&
                                            exportPdfButton(result)}
                                    </div>
                                )}

                                {result.isError ? (
                                    <div className="flex items-center gap-3 rounded-lg border border-danger-200 bg-danger-50 p-4 text-body text-danger-700">
                                        <Warning className="size-5 shrink-0" />
                                        {t('errors.batchLoadFailed', {
                                            name: blockTitle(result.batch),
                                        })}
                                    </div>
                                ) : !summary || summary.totalClassesHeld === 0 ? (
                                    isMulti && (
                                        <div className="rounded-lg border border-neutral-200 bg-white p-6 text-center shadow-sm">
                                            <p className="text-body font-medium text-neutral-700">
                                                {t('emptyState.title')}
                                            </p>
                                            <p className="mt-1 text-caption text-neutral-500">
                                                {t('emptyState.description')}
                                            </p>
                                        </div>
                                    )
                                ) : (
                                    <>
                                        {/* Metric cards */}
                                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                                            <MetricCard
                                                label={t('metrics.avgAttendance')}
                                                value={`${summary.avgAttendancePct.toFixed(1)}%`}
                                                sub={t('metrics.learnersCount', {
                                                    count: summary.learnerCount,
                                                })}
                                                icon={<CalendarCheck className="size-5" />}
                                            />
                                            <MetricCard
                                                label={t('metrics.classesHeld')}
                                                value={`${summary.totalClassesHeld}`}
                                                icon={<Presentation className="size-5" />}
                                            />
                                            <MetricCard
                                                label={t('metrics.avgDurationPerClass')}
                                                value={formatDuration(
                                                    summary.avgDurationMinutes,
                                                    t
                                                )}
                                                sub={t('metrics.presentLearners')}
                                                icon={<Timer className="size-5" />}
                                            />
                                            <MetricCard
                                                label={t('metrics.avgEngagement')}
                                                value={`${summary.avgEngagementIndex}`}
                                                sub={t('metrics.participationPoints')}
                                                icon={<ChatsCircle className="size-5" />}
                                                info={t('metrics.engagementInfo')}
                                            />
                                        </div>

                                        {/* Attendance trend */}
                                        <SectionCard
                                            title={t('sections.attendanceTrendTitle')}
                                            subtitle={t('sections.attendanceTrendSubtitle')}
                                        >
                                            <LiveAttendanceChart data={summary.timeline} />
                                        </SectionCard>

                                        {/* Class-wise table */}
                                        <SectionCard
                                            title={t('sections.classBreakdownTitle')}
                                            subtitle={t('sections.classBreakdownSubtitle')}
                                        >
                                            <div className="overflow-auto">
                                                <MyTable
                                                    data={perClassTable(summary)}
                                                    columns={perClassColumns}
                                                    isLoading={false}
                                                    error={null}
                                                    currentPage={0}
                                                    scrollable
                                                />
                                            </div>
                                        </SectionCard>

                                        {/* Leaderboard */}
                                        <SectionCard
                                            title={t('sections.leaderboardTitle')}
                                            subtitle={t('sections.leaderboardSubtitle')}
                                        >
                                            <MyTable
                                                data={leaderTable(summary, page)}
                                                columns={leaderColumns}
                                                isLoading={false}
                                                error={null}
                                                currentPage={page}
                                            />
                                            {lbTotalPages > 1 && (
                                                <div className="mt-6 flex justify-center">
                                                    <MyPagination
                                                        currentPage={page}
                                                        totalPages={lbTotalPages}
                                                        onPageChange={(next) =>
                                                            setLbPages((prev) => ({
                                                                ...prev,
                                                                [result.batch.packageSessionId]:
                                                                    next,
                                                            }))
                                                        }
                                                    />
                                                </div>
                                            )}
                                        </SectionCard>
                                    </>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
