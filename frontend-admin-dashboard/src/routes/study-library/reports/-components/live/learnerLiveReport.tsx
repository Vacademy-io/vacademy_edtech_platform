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
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { StatusChip } from '@/components/design-system/status-chips';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { resolveInstituteLogoUrl } from './-utils/instituteLogo';
import LiveReportFilterForm, { AppliedLiveBatch, AppliedLiveFilters } from './liveReportFilterForm';
import { LiveStudentReport, useLiveBatchReports } from './-services/liveReportApi';
import {
    BatchLiveSummary,
    LearnerLiveStats,
    computeBatchSummary,
    computeLearnerStats,
    formatDuration,
    parseEngagement,
    perClassEngagement,
} from './-utils/liveCompute';
import { exportLearnerLivePdf } from './-utils/exportLivePdf';
import { MetricCard, SectionCard } from './liveUiBits';
import { buildReportCsv, csvFileName, downloadCsv, num, csvDate } from '../../-utils/reportCsv';

interface ClassRow {
    date: string;
    title: string;
    status: string;
    duration: string;
    talkTime: string;
    chats: string;
    polls: string;
    raiseHand: string;
}

function buildClassColumns(t: TFunction): ColumnDef<ClassRow>[] {
    return [
        { accessorKey: 'date', header: t('table.date') },
        { accessorKey: 'title', header: t('table.class') },
        {
            accessorKey: 'status',
            header: t('table.status'),
            cell: ({ row }) => {
                const present = row.original.status === 'PRESENT';
                return (
                    <StatusChip
                        text={present ? t('table.present') : t('table.absent')}
                        textSize="text-caption"
                        status={present ? 'SUCCESS' : 'DANGER'}
                    />
                );
            },
        },
        { accessorKey: 'duration', header: t('table.duration') },
        { accessorKey: 'talkTime', header: t('table.talkTime') },
        { accessorKey: 'chats', header: t('table.chats') },
        { accessorKey: 'polls', header: t('table.polls') },
        { accessorKey: 'raiseHand', header: t('table.raiseHand') },
    ];
}

/** The learner's slice of one batch's report. */
interface LearnerBatchResult {
    batch: AppliedLiveBatch;
    batchSummary: BatchLiveSummary | null;
    learnerStudent: LiveStudentReport | null;
    learner: LearnerLiveStats | null;
    /** This learner's 0–100 engagement score, normalized to the batch's most active learner. */
    engagementScore: number;
    isError: boolean;
}

export default function LearnerLiveReport() {
    const { t } = useTranslation('studyLibraryLearnerLiveReport');
    const { instituteDetails } = useInstituteDetailsStore();
    const batchTerm = getTerminology(ContentTerms.Batch, SystemTerms.Batch);
    const [applied, setApplied] = useState<AppliedLiveFilters | null>(null);
    const [exporting, setExporting] = useState<string | null>(null);
    const [exportingCsv, setExportingCsv] = useState(false);
    const classColumns = useMemo(() => buildClassColumns(t), [t]);

    const queries = useLiveBatchReports(
        applied?.batches.map((b) => b.packageSessionId) ?? [],
        applied?.startDate || '',
        applied?.endDate || '',
        !!applied,
        applied?.runId
    );
    const isFetching = queries.some((q) => q.isFetching);
    const resultsKey = queries.map((q) => `${q.status}:${q.dataUpdatedAt}`).join('|');
    const results = useMemo<LearnerBatchResult[]>(
        () =>
            (applied?.batches ?? []).map((batch, index) => {
                const data = queries[index]?.data;
                const batchSummary = data ? computeBatchSummary(data) : null;
                const learnerStudent = data?.find((s) => s.studentId === applied?.userId) ?? null;
                const learner = learnerStudent ? computeLearnerStats(learnerStudent) : null;
                const engagementScore =
                    learner && batchSummary && batchSummary.maxEngagementPerClass > 0
                        ? Math.round(
                              (perClassEngagement(learner.engagementIndex, learner.attended) /
                                  batchSummary.maxEngagementPerClass) *
                                  100
                          )
                        : 0;
                return {
                    batch,
                    batchSummary,
                    learnerStudent,
                    learner,
                    engagementScore,
                    isError: Boolean(queries[index]?.isError),
                };
            }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [applied, resultsKey]
    );
    const isMulti = (applied?.batches.length ?? 0) > 1;
    const allFailed = results.length > 0 && results.every((r) => r.isError);
    const withData = results.filter((r) => r.learner && r.learner.total > 0);
    const hasData = withData.length > 0;

    const fmtDate = (d: string | null) =>
        d && dayjs(d).isValid() ? dayjs(d).format('DD MMM YYYY') : '—';

    const blockTitle = (batch: AppliedLiveBatch) => batch.label || batch.courseName;

    const sortedSessions = (student: LiveStudentReport) =>
        [...student.sessions].sort((a, b) =>
            (a.meetingDate ?? '').localeCompare(b.meetingDate ?? '')
        );

    const classTable = (student: LiveStudentReport) => ({
        content: sortedSessions(student).map((r) => {
            const e = parseEngagement(r.engagementData);
            return {
                date: fmtDate(r.meetingDate),
                title: r.title,
                status: r.attendanceStatus ?? 'UNMARKED',
                duration: formatDuration(r.durationMinutes, t),
                talkTime: e ? `${Math.round(e.talkTimeSeconds / 60)}m` : '—',
                chats: e ? String(e.chats) : '—',
                polls: e ? String(e.pollVotes) : '—',
                raiseHand: e ? String(e.raiseHand) : '—',
            };
        }),
        total_pages: 1,
        page_no: 0,
        page_size: student.sessions.length,
        total_elements: student.sessions.length,
        last: true,
    });

    const handleExport = async (result: LearnerBatchResult) => {
        if (!result.learner || !result.learnerStudent || !result.batchSummary || !applied) return;
        setExporting(result.batch.packageSessionId);
        try {
            const logoUrl = await resolveInstituteLogoUrl(instituteDetails?.institute_logo_file_id);
            await exportLearnerLivePdf(
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
                result.learner,
                result.learnerStudent.sessions,
                result.batchSummary
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
            const learnerName = withData[0]?.learner?.fullName ?? applied.learnerName ?? '';
            const csv = buildReportCsv([
                {
                    title: t('csv.summaryTitle'),
                    headers: [
                        batchTerm,
                        t('csv.learner'),
                        t('csv.email'),
                        t('csv.startDate'),
                        t('csv.endDate'),
                        t('csv.attendancePct'),
                        t('csv.batchAttendancePct', { batch: batchTerm }),
                        t('csv.attended'),
                        t('csv.totalClasses'),
                        t('csv.avgDurationMin'),
                        t('csv.batchAvgDurationMin', { batch: batchTerm }),
                        t('csv.engagementScore'),
                        t('csv.batchEngagementScore', { batch: batchTerm }),
                    ],
                    rows: withData.map((r) => [
                        blockTitle(r.batch),
                        r.learner!.fullName,
                        r.learner!.email,
                        applied.startDate,
                        applied.endDate,
                        num(r.learner!.attendancePercentage),
                        num(r.batchSummary?.avgAttendancePct),
                        r.learner!.attended,
                        r.learner!.total,
                        num(r.learner!.avgDurationMinutes),
                        num(r.batchSummary?.avgDurationMinutes),
                        r.engagementScore,
                        r.batchSummary?.avgEngagementScore ?? '',
                    ]),
                },
                {
                    title: t('csv.classesTitle'),
                    headers: [
                        batchTerm,
                        t('table.date'),
                        t('table.class'),
                        t('table.status'),
                        t('csv.durationMin'),
                        t('csv.talkTimeMin'),
                        t('table.chats'),
                        t('table.polls'),
                        t('table.raiseHand'),
                        t('csv.emojis'),
                    ],
                    rows: withData.flatMap((r) =>
                        sortedSessions(r.learnerStudent!).map((s) => {
                            const e = parseEngagement(s.engagementData);
                            return [
                                blockTitle(r.batch),
                                csvDate(s.meetingDate),
                                s.title,
                                s.attendanceStatus ?? 'UNMARKED',
                                num(s.durationMinutes),
                                e ? num(e.talkTimeSeconds / 60) : '',
                                e ? e.chats : '',
                                e ? e.pollVotes : '',
                                e ? e.raiseHand : '',
                                e ? e.emojis : '',
                            ];
                        })
                    ),
                },
            ]);
            downloadCsv(
                csvFileName(t('csv.fileStem'), learnerName, applied.startDate, applied.endDate),
                csv
            );
            toast.success(t('export.csvExportSuccess'));
        } catch {
            toast.error(t('export.csvExportFailed'));
        } finally {
            setExportingCsv(false);
        }
    };

    const exportPdfButton = (result: LearnerBatchResult) => (
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

    const learnerName = withData[0]?.learner?.fullName ?? applied?.learnerName ?? '';

    return (
        <div className="space-y-6">
            <LiveReportFilterForm withLearner submitting={isFetching} onApply={setApplied} />

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
                    {/* Header */}
                    <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="space-y-2">
                                <h3 className="text-subtitle font-semibold text-primary-500">
                                    {learnerName}
                                </h3>
                                <div className="flex flex-wrap items-center gap-2 text-body">
                                    <span className="rounded-md bg-primary-50 px-2 py-1 text-caption font-medium text-neutral-700">
                                        {isMulti
                                            ? t('batchCount', {
                                                  count: results.length,
                                                  term: batchTerm,
                                              })
                                            : results[0]?.batch.courseName}
                                    </span>
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
                                {!isMulti && results[0]?.learner && exportPdfButton(results[0])}
                            </div>
                        </div>
                    </div>

                    {results.map((result) => {
                        const { learner, batchSummary, learnerStudent } = result;
                        const hasBlockData = Boolean(
                            learner && learner.total > 0 && batchSummary && learnerStudent
                        );
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
                                        {hasBlockData && exportPdfButton(result)}
                                    </div>
                                )}

                                {result.isError ? (
                                    <div className="flex items-center gap-3 rounded-lg border border-danger-200 bg-danger-50 p-4 text-body text-danger-700">
                                        <Warning className="size-5 shrink-0" />
                                        {t('errors.batchLoadFailed', {
                                            name: blockTitle(result.batch),
                                        })}
                                    </div>
                                ) : !hasBlockData ? (
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
                                        {/* Metric cards with batch comparison */}
                                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                                            <MetricCard
                                                label={t('metrics.attendance')}
                                                value={`${learner!.attendancePercentage.toFixed(1)}%`}
                                                sub={t('metrics.batchPercentage', {
                                                    value: batchSummary!.avgAttendancePct.toFixed(
                                                        1
                                                    ),
                                                })}
                                                icon={<CalendarCheck className="size-5" />}
                                            />
                                            <MetricCard
                                                label={t('metrics.classesAttended')}
                                                value={`${learner!.attended}/${learner!.total}`}
                                                icon={<Presentation className="size-5" />}
                                            />
                                            <MetricCard
                                                label={t('metrics.avgDurationPerClass')}
                                                value={formatDuration(
                                                    learner!.avgDurationMinutes,
                                                    t
                                                )}
                                                sub={t('metrics.batchDuration', {
                                                    value: formatDuration(
                                                        batchSummary!.avgDurationMinutes,
                                                        t
                                                    ),
                                                })}
                                                icon={<Timer className="size-5" />}
                                            />
                                            <MetricCard
                                                label={t('metrics.engagement')}
                                                value={`${result.engagementScore}`}
                                                sub={t('metrics.batchEngagement', {
                                                    value: batchSummary!.avgEngagementScore,
                                                })}
                                                icon={<ChatsCircle className="size-5" />}
                                                info={t('metrics.engagementInfo')}
                                            />
                                        </div>

                                        {/* Class history */}
                                        <SectionCard
                                            title={t('sections.classHistoryTitle')}
                                            subtitle={t('sections.classHistorySubtitle')}
                                        >
                                            <div className="overflow-auto">
                                                <MyTable
                                                    data={classTable(learnerStudent!)}
                                                    columns={classColumns}
                                                    isLoading={false}
                                                    error={null}
                                                    currentPage={0}
                                                    scrollable
                                                />
                                            </div>
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
