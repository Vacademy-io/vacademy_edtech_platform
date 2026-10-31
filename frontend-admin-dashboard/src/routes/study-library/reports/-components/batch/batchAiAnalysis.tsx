import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MyButton } from '@/components/design-system/button';
import DateRangeFilter from '@/components/design-system/date-range-filter';
import { usePacageDetails } from '../../-store/usePacageDetails';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import BatchMultiSelect, { useBatchLookup } from '../batchMultiSelect';
import { buildReportCsv, csvFileName, downloadCsv } from '../../-utils/reportCsv';
import { TokenKey } from '@/constants/auth/tokens';
import { fetchStudents } from '@/routes/manage-students/students-list/-services/getStudentTable';
import {
    initiateStudentAnalysis,
    getStudentReport,
    getStudentReportFull,
} from '@/services/student-analysis';
import { ComprehensiveReportDialog } from '@/routes/manage-students/students-list/-components/students-list/student-side-view/student-reports/ComprehensiveReportDialog';
import type { ComprehensiveStudentReport } from '@/types/student-analysis';
import { toast } from 'sonner';
import {
    CheckCircle,
    XCircle,
    CircleNotch,
    Clock,
    Sparkle,
    Eye,
    ArrowClockwise,
    CalendarBlank,
    CaretDown,
    FileCsv,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import dayjs from 'dayjs';

// All v2 report modules — batch runs always include everything.
const ALL_MODULES = [
    'attendance',
    'live_classes',
    'academics',
    'activity',
    'progress',
    'certificates',
    'assignments',
    'doubts',
    'login',
];

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 4 * 60 * 1000; // 4 min per student before we consider it stuck

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

type RowStatus = 'queued' | 'generating' | 'completed' | 'failed';

interface StudentRow {
    userId: string;
    name: string;
    email?: string;
    /** Batch the learner's enrolment row belongs to — the report is scoped to it. */
    packageSessionId: string;
    batchLabel: string;
    status: RowStatus;
    processId?: string;
    error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface BatchAiAnalysisProps {
    /**
     * When rendered inside a batch-scoped surface (e.g. Course Details → Reports),
     * the batch is already known — the course/session/level picker is hidden and
     * reports are generated for the learners of this package session.
     */
    fixedPackageSessionId?: string;
}

export default function BatchAiAnalysis({ fixedPackageSessionId }: BatchAiAnalysisProps = {}) {
    const { t } = useTranslation('studyLibraryBatchAiAnalysis');
    const isBatchFixed = Boolean(fixedPackageSessionId);
    const { setPacageSessionId } = usePacageDetails();
    const batchLookup = useBatchLookup();
    const batchTerm = getTerminology(ContentTerms.Batch, SystemTerms.Batch);

    const [rows, setRows] = useState<StudentRow[]>([]);
    const [running, setRunning] = useState(false);
    const [preparing, setPreparing] = useState(false);
    // Fixed-batch mode: keep the date filter collapsed behind a one-line summary.
    const [showDateFilter, setShowDateFilter] = useState(false);
    const stopRef = useRef(false);

    // Report viewer
    const [dialogOpen, setDialogOpen] = useState(false);
    const [viewReport, setViewReport] = useState<ComprehensiveStudentReport | null>(null);
    const [viewProcessId, setViewProcessId] = useState<string | null>(null);
    const [viewName, setViewName] = useState<string | undefined>(undefined);

    const instituteId = (() => {
        const tokenData = getTokenDecodedData(getTokenFromCookie(TokenKey.accessToken));
        return (tokenData && Object.keys(tokenData.authorities)[0]) || '';
    })();

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

    const completedCount = rows.filter((r) => r.status === 'completed').length;
    const failedCount = rows.filter((r) => r.status === 'failed').length;
    const doneCount = completedCount + failedCount;
    const progressPct = rows.length > 0 ? Math.round((doneCount / rows.length) * 100) : 0;

    /**
     * Fetch every ACTIVE learner enrolled in the selected package sessions
     * (paginated). A learner in two selected batches gets one row per batch —
     * each AI report is scoped to a batch.
     */
    const fetchAllStudents = async (packageSessionIds: string[]): Promise<StudentRow[]> => {
        const pageSize = 100;
        const collected: StudentRow[] = [];
        let pageNo = 0;
        let totalPages = 1;
        do {
            const res = await fetchStudents({
                pageNo,
                pageSize,
                filters: {
                    institute_ids: [instituteId],
                    package_session_ids: packageSessionIds,
                    statuses: ['ACTIVE'],
                },
            });
            totalPages = res.total_pages ?? 1;
            (res.content ?? []).forEach((s) => {
                if (s.user_id) {
                    // The list is filtered by these batches, so the row's batch is
                    // one of them; fall back to the only selection if it's missing.
                    const packageSessionId =
                        s.package_session_id ||
                        (packageSessionIds.length === 1 ? packageSessionIds[0] ?? '' : '');
                    collected.push({
                        userId: s.user_id,
                        name: s.full_name || s.user_id,
                        email: s.email,
                        packageSessionId,
                        batchLabel: batchLookup.get(packageSessionId)?.label ?? '',
                        status: 'queued',
                    });
                }
            });
            pageNo += 1;
        } while (pageNo < totalPages);
        return collected;
    };

    /** Poll a single process until it reaches a terminal state (or times out). */
    const pollUntilDone = async (processId: string): Promise<RowStatus> => {
        const start = Date.now();
        while (Date.now() - start < POLL_TIMEOUT_MS) {
            if (stopRef.current) return 'failed';
            try {
                const report = await getStudentReport(processId);
                if (report.status === 'COMPLETED') return 'completed';
                if (report.status === 'FAILED' || report.status === 'ERROR') return 'failed';
            } catch {
                // transient — keep polling
            }
            await sleep(POLL_INTERVAL_MS);
        }
        return 'failed';
    };

    const rowKey = (row: Pick<StudentRow, 'userId' | 'packageSessionId'>) =>
        `${row.userId}|${row.packageSessionId}`;

    /** Run the queue sequentially: initiate → poll → next. */
    const runQueue = async (queue: StudentRow[], startDate: string, endDate: string) => {
        setRunning(true);
        stopRef.current = false;
        for (let i = 0; i < queue.length; i++) {
            if (stopRef.current) break;
            const row = queue[i];
            if (!row || row.status === 'completed') continue;

            setRows((prev) =>
                prev.map((r) =>
                    rowKey(r) === rowKey(row) ? { ...r, status: 'generating', error: undefined } : r
                )
            );

            try {
                const res = await initiateStudentAnalysis(
                    {
                        user_id: row.userId,
                        start_date_iso: startDate,
                        end_date_iso: endDate,
                        report_version: 'v2',
                        batch_id: row.packageSessionId,
                        package_session_id: row.packageSessionId,
                        include_modules: ALL_MODULES,
                        send_email: false, // bulk run — don't email learners
                    },
                    instituteId
                );
                const processId = res.process_id;
                if (!processId) {
                    setRows((prev) =>
                        prev.map((r) =>
                            rowKey(r) === rowKey(row)
                                ? {
                                      ...r,
                                      status: 'failed',
                                      error: t('toast.generationStartFailed'),
                                  }
                                : r
                        )
                    );
                    continue;
                }
                const finalStatus = await pollUntilDone(processId);
                setRows((prev) =>
                    prev.map((r) =>
                        rowKey(r) === rowKey(row)
                            ? {
                                  ...r,
                                  status: finalStatus,
                                  processId,
                                  error:
                                      finalStatus === 'failed'
                                          ? t('toast.generationFailedOrTimedOut')
                                          : undefined,
                              }
                            : r
                    )
                );
            } catch (e) {
                setRows((prev) =>
                    prev.map((r) =>
                        rowKey(r) === rowKey(row)
                            ? { ...r, status: 'failed', error: t('toast.generationStartFailed') }
                            : r
                    )
                );
            }
        }
        setRunning(false);
    };

    const onSubmit = async (data: FormValues) => {
        const packageSessionIds = fixedPackageSessionId ? [fixedPackageSessionId] : data.batches;
        if (!packageSessionIds.length) {
            toast.error(t('toast.resolveBatchFailed'));
            return;
        }
        setPacageSessionId(packageSessionIds[0] ?? '');

        setPreparing(true);
        setRows([]);
        try {
            const students = await fetchAllStudents(packageSessionIds);
            if (students.length === 0) {
                toast.error(t('toast.noActiveLearners'));
                setPreparing(false);
                return;
            }
            setRows(students);
            setPreparing(false);
            await runQueue(students, data.startDate, data.endDate);
            toast.success(t('toast.generationFinished'));
        } catch {
            toast.error(t('toast.loadLearnersFailed'));
            setPreparing(false);
        }
    };

    const handleStop = () => {
        stopRef.current = true;
        toast.info(t('toast.stopping'));
    };

    const handleRetryFailed = async () => {
        const failed = rows.filter((r) => r.status === 'failed');
        if (failed.length === 0) return;
        // We need the last-used dates; re-read from the form (each row keeps its batch).
        const values = watch();
        if (!values.startDate || !values.endDate) {
            toast.error(t('toast.reselectRequired'));
            return;
        }
        // reset failed rows to queued
        setRows((prev) =>
            prev.map((r) =>
                r.status === 'failed' ? { ...r, status: 'queued', error: undefined } : r
            )
        );
        await runQueue(failed, values.startDate, values.endDate);
    };

    const isMulti = new Set(rows.map((r) => r.packageSessionId)).size > 1;

    /** CSV of the run: one row per learner with its batch, status and report id. */
    const handleExportCsv = () => {
        if (!rows.length) return;
        const csv = buildReportCsv([
            {
                title: t('csv.title'),
                headers: [
                    batchTerm,
                    t('csv.name'),
                    t('csv.email'),
                    t('csv.status'),
                    t('csv.processId'),
                    t('csv.error'),
                ],
                rows: rows.map((r) => [
                    r.batchLabel,
                    r.name,
                    r.email ?? '',
                    t(`status.${r.status}`),
                    r.processId ?? '',
                    r.error ?? '',
                ]),
            },
        ]);
        downloadCsv(csvFileName(t('csv.fileStem'), startDate, endDate), csv);
        toast.success(t('csv.exportSuccess'));
    };

    const handleView = async (row: StudentRow) => {
        if (!row.processId) return;
        try {
            const full = await getStudentReportFull(row.processId);
            if (full.report_version === 'v2' && full.comprehensive_report) {
                setViewReport(full.comprehensive_report);
                setViewProcessId(row.processId);
                setViewName(full.name || `${row.name} — Report`);
                setDialogOpen(true);
            } else {
                toast.error(t('toast.reportNotReady'));
            }
        } catch {
            toast.error(t('toast.loadReportFailed'));
        }
    };

    return (
        <div className="space-y-6">
            {/* Filter card */}
            <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center gap-2">
                    <Sparkle size={18} className="text-primary-500" weight="fill" />
                    <p className="text-sm font-medium text-neutral-700">{t('description')}</p>
                </div>
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    {!isBatchFixed && (
                        <BatchMultiSelect
                            selected={selectedBatches}
                            onChange={(ids) => {
                                setValue('batches', ids);
                                if (ids.length) clearErrors('batches');
                            }}
                            error={errors.batches?.message}
                            disabled={running || preparing}
                        />
                    )}

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
                                    disabled={running || preparing}
                                >
                                    {preparing
                                        ? t('actions.loadingLearners')
                                        : running
                                          ? t('actions.generating')
                                          : t('actions.generateReports')}
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
                                    className="h-9 px-4 text-sm font-medium"
                                    disabled={running || preparing}
                                >
                                    {preparing
                                        ? t('actions.loadingLearners')
                                        : running
                                          ? t('actions.generating')
                                          : t('actions.generateReports')}
                                </MyButton>
                            </div>
                        </div>
                    )}

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

            {/* Progress + results */}
            {rows.length > 0 && (
                <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <span className="text-sm font-semibold text-neutral-800">
                                {t('progress.doneCount', { done: doneCount, total: rows.length })}
                            </span>
                            {completedCount > 0 && (
                                <span className="text-xs text-success-600">
                                    {t('progress.completedCount', { count: completedCount })}
                                </span>
                            )}
                            {failedCount > 0 && (
                                <span className="text-xs text-danger-600">
                                    {t('progress.failedCount', { count: failedCount })}
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            {!running && (
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    className="h-8 px-3 text-caption"
                                    onClick={handleExportCsv}
                                >
                                    <FileCsv size={14} className="me-1" />
                                    {t('actions.exportCsv')}
                                </MyButton>
                            )}
                            {running && (
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    className="h-8 px-3 text-xs"
                                    onClick={handleStop}
                                >
                                    {t('actions.stop')}
                                </MyButton>
                            )}
                            {!running && failedCount > 0 && (
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    className="h-8 px-3 text-xs"
                                    onClick={handleRetryFailed}
                                >
                                    <ArrowClockwise size={14} className="mr-1" />
                                    {t('actions.retryFailed')}
                                </MyButton>
                            )}
                        </div>
                    </div>

                    {/* Progress bar */}
                    <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-neutral-100">
                        {/* eslint-disable-next-line -- dynamic progress width (0-100%), not a static style */}
                        <div
                            className="h-full rounded-full bg-primary-500 transition-all duration-300"
                            style={{ width: `${progressPct}%` }}
                        />
                    </div>

                    <div className="flex max-h-96 flex-col divide-y divide-neutral-100 overflow-y-auto">
                        {rows.map((row) => (
                            <div
                                key={rowKey(row)}
                                className="flex items-center justify-between gap-3 py-2"
                            >
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium text-neutral-800">
                                        {row.name}
                                    </p>
                                    <p className="truncate text-xs text-neutral-400">
                                        {[row.email, isMulti ? row.batchLabel : '']
                                            .filter(Boolean)
                                            .join(' · ')}
                                    </p>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                    <StatusBadge status={row.status} t={t} />
                                    {row.status === 'completed' && row.processId && (
                                        <MyButton
                                            type="button"
                                            buttonType="secondary"
                                            className="h-7 px-2 text-xs"
                                            onClick={() => handleView(row)}
                                        >
                                            <Eye size={14} className="mr-1" />
                                            {t('actions.view')}
                                        </MyButton>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <ComprehensiveReportDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                processId={viewProcessId}
                report={viewReport}
                reportName={viewName}
            />
        </div>
    );
}

function StatusBadge({ status, t }: { status: RowStatus; t: TFunction }) {
    const map: Record<RowStatus, { label: string; cls: string; icon: JSX.Element }> = {
        queued: {
            label: t('status.queued'),
            cls: 'bg-neutral-100 text-neutral-500',
            icon: <Clock size={12} />,
        },
        generating: {
            label: t('status.generating'),
            cls: 'bg-primary-50 text-primary-600',
            icon: <CircleNotch size={12} className="animate-spin" />,
        },
        completed: {
            label: t('status.completed'),
            cls: 'bg-success-50 text-success-700',
            icon: <CheckCircle size={12} weight="fill" />,
        },
        failed: {
            label: t('status.failed'),
            cls: 'bg-danger-50 text-danger-700',
            icon: <XCircle size={12} weight="fill" />,
        },
    };
    const s = map[status];
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                s.cls
            )}
        >
            {s.icon}
            {s.label}
        </span>
    );
}
