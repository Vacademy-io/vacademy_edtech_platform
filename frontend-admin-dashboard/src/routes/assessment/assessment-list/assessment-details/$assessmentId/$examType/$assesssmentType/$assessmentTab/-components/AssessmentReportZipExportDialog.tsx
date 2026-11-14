import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { StatusChip } from '@/components/design-system/status-chips';
import { Progress } from '@/components/ui/progress';
import { CaretDown, CaretUp, DownloadSimple, FileZip, Warning } from '@phosphor-icons/react';
import { downloadFileFromUrl } from '@/lib/file-download';
import { cn } from '@/lib/utils';
import {
    assembleReportZipExport,
    cancelReportZipExport,
    continueReportZipExport,
    getRecentReportZipExports,
    getReportZipExportStatus,
    initiateReportZipExport,
    ReportZipJobSummary,
    ReportZipStatus,
} from '../-services/assessment-details-services';
import { SelectedSubmissionsFilterInterface } from './AssessmentSubmissionsTab';

// Job statuses for which the worker has no further active work — polling stops.
const NON_POLLING_STATUSES = new Set(['COMPLETED', 'FAILED', 'PARTIAL', 'CANCELLED']);

// A background job advances in ~batch-sized steps, so sub-second freshness buys
// nothing — 5s keeps the progress bar honest without hammering the status API.
const POLL_INTERVAL_MS = 5000;

const statusChipFor = (status: ReportZipStatus['status'] | string) => {
    switch (status) {
        case 'COMPLETED':
            return (
                <StatusChip
                    text={i18next.t('assessmentReportZipExportDialog:statusChips.completed')}
                    textSize="text-caption"
                    status="SUCCESS"
                />
            );
        case 'PARTIAL':
            return (
                <StatusChip
                    text={i18next.t('assessmentReportZipExportDialog:statusChips.partial')}
                    textSize="text-caption"
                    status="WARNING"
                />
            );
        case 'FAILED':
            return (
                <StatusChip
                    text={i18next.t('assessmentReportZipExportDialog:statusChips.failed')}
                    textSize="text-caption"
                    status="DANGER"
                />
            );
        case 'CANCELLED':
            return (
                <StatusChip
                    text={i18next.t('assessmentReportZipExportDialog:statusChips.cancelled')}
                    textSize="text-caption"
                    status="INFO"
                />
            );
        case 'IN_PROGRESS':
            return (
                <StatusChip
                    text={i18next.t('assessmentReportZipExportDialog:statusChips.inProgress')}
                    textSize="text-caption"
                    status="INFO"
                />
            );
        case 'PENDING':
        default:
            return (
                <StatusChip
                    text={i18next.t('assessmentReportZipExportDialog:statusChips.queued')}
                    textSize="text-caption"
                    status="INFO"
                />
            );
    }
};

interface AssessmentReportZipExportDialogProps {
    assessmentId: string;
    instituteId: string | undefined;
    selectedFilter: SelectedSubmissionsFilterInterface;
    // Bulk-actions mode: export exactly these attempts. Absent/empty → export
    // everything matching the current filter (header-button mode).
    attemptIds?: string[];
    // Controlled mode (bulk actions opens the dialog without its own trigger).
    // When omitted the dialog manages its own open state and renders a trigger.
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}

export const AssessmentReportZipExportDialog = ({
    assessmentId,
    instituteId,
    selectedFilter,
    attemptIds,
    open: controlledOpen,
    onOpenChange,
}: AssessmentReportZipExportDialogProps) => {
    const { t } = useTranslation('assessmentReportZipExportDialog');
    const isControlled = controlledOpen !== undefined;
    const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
    const open = isControlled ? controlledOpen : uncontrolledOpen;
    const setOpen = isControlled ? (onOpenChange ?? (() => {})) : setUncontrolledOpen;
    const isBulkSelection = !!attemptIds && attemptIds.length > 0;
    const [regenerate, setRegenerate] = useState(false);
    const [activeJobId, setActiveJobId] = useState<string | null>(null);
    const [failuresExpanded, setFailuresExpanded] = useState(false);
    const [isStarting, setIsStarting] = useState(false);
    const [isActing, setIsActing] = useState(false);

    const recentQuery = useQuery({
        queryKey: ['REPORT_ZIP_EXPORT_RECENT', assessmentId, instituteId],
        queryFn: () => getRecentReportZipExports(assessmentId, instituteId, 5),
        enabled: open,
    });

    const statusQuery = useQuery({
        queryKey: ['REPORT_ZIP_EXPORT_STATUS', activeJobId, instituteId],
        queryFn: () => getReportZipExportStatus(activeJobId as string, instituteId),
        enabled: open && !!activeJobId,
        refetchInterval: (query) => {
            const data = query.state.data as ReportZipStatus | undefined;
            if (!data || !NON_POLLING_STATUSES.has(data.status)) return POLL_INTERVAL_MS;
            return false;
        },
    });

    const status = statusQuery.data;

    const handleStart = async () => {
        setIsStarting(true);
        try {
            const response = await initiateReportZipExport({
                assessmentId,
                instituteId,
                attemptIds: isBulkSelection ? attemptIds : undefined,
                filter: isBulkSelection ? undefined : selectedFilter,
                regenerate,
            });
            setActiveJobId(response.job_id);
            if (response.already_running) {
                toast.info(t('toasts.alreadyRunning'));
            } else {
                toast.success(
                    t('toasts.exportStarted', {
                        count: response.total_count,
                    })
                );
            }
        } catch {
            toast.error(t('toasts.startFailed'));
        } finally {
            setIsStarting(false);
        }
    };

    const handleContinue = async () => {
        if (!activeJobId) return;
        setIsActing(true);
        try {
            await continueReportZipExport(activeJobId, instituteId);
            toast.success(t('toasts.resuming'));
            statusQuery.refetch();
        } catch {
            toast.error(t('toasts.resumeFailed'));
        } finally {
            setIsActing(false);
        }
    };

    const handleCancel = async () => {
        if (!activeJobId) return;
        setIsActing(true);
        try {
            await cancelReportZipExport(activeJobId, instituteId);
            toast.success(t('toasts.cancelled'));
            statusQuery.refetch();
        } catch {
            toast.error(t('toasts.cancelFailed'));
        } finally {
            setIsActing(false);
        }
    };

    const downloadJob = async (jobId: string, assemble: boolean) => {
        setIsActing(true);
        try {
            if (assemble) {
                await assembleReportZipExport(jobId, instituteId);
            }
            // Always fetch a fresh status right before download — the media
            // service presigns URLs with a short expiry, so a stored URL can go
            // stale between actions.
            const fresh = await getReportZipExportStatus(jobId, instituteId);
            if (!fresh.download_url) {
                toast.error(t('toasts.downloadNotReady'));
                return;
            }
            // Fetch the bytes and save under our own name. A plain <a download>
            // is ignored for cross-origin URLs, so the browser would fall back
            // to the S3 object name (uuid-prefixed) instead of the friendly
            // "<assessment>_reports.zip" shown in the dialog.
            const baseName = (fresh.output_file_name || `assessment_reports`).replace(/\.zip$/i, '');
            await downloadFileFromUrl(fresh.download_url, baseName, 'zip');
            if (jobId === activeJobId) statusQuery.refetch();
        } catch {
            toast.error(t('toasts.downloadFailed'));
        } finally {
            setIsActing(false);
        }
    };

    const progressPercent = status && status.total_count > 0
        ? Math.round(((status.completed_count + status.failed_count + status.skipped_count) / status.total_count) * 100)
        : 0;

    return (
        <MyDialog
            open={open}
            onOpenChange={setOpen}
            heading={t('dialog.heading')}
            triggerTooltip={t('trigger.tooltip')}
            dialogWidth="max-w-xl"
            trigger={
                isControlled ? undefined : (
                    <MyButton
                        type="button"
                        scale="small"
                        buttonType="secondary"
                        className="!h-10 !min-w-0 gap-1.5 px-3 font-medium"
                        title={t('trigger.label')}
                        aria-label={t('trigger.label')}
                    >
                        <FileZip size={16} />
                        {t('trigger.short')}
                    </MyButton>
                )
            }
        >
            <div className="flex flex-col gap-5">
                {!activeJobId && (
                    <>
                        <p className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-body text-neutral-700">
                            {isBulkSelection
                                ? t('description.bulk', { count: attemptIds.length })
                                : t('description.all')}
                        </p>
                        <label className="flex cursor-pointer items-center gap-2">
                            <input
                                type="checkbox"
                                checked={regenerate}
                                onChange={(e) => setRegenerate(e.target.checked)}
                            />
                            <span className="text-caption text-neutral-600">
                                {t('regenerateLabel')}
                            </span>
                        </label>
                        <MyButton
                            type="button"
                            scale="medium"
                            buttonType="primary"
                            disable={isStarting}
                            onClick={handleStart}
                        >
                            {isStarting ? t('starting') : t('startButton')}
                        </MyButton>
                    </>
                )}

                {activeJobId && status && (
                    <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                            <p className="text-body font-semibold text-neutral-700">
                                {status.output_file_name || t('defaultFileName')}
                            </p>
                            {statusChipFor(status.status)}
                        </div>

                        <div className="flex flex-col gap-1">
                            <Progress value={progressPercent} />
                            <p className="text-caption text-neutral-500">
                                {t('progress.summary', {
                                    completed: status.completed_count,
                                    total: status.total_count,
                                })}
                                {status.failed_count > 0
                                    ? ` · ${t('progress.failedCount', { count: status.failed_count })}`
                                    : ''}
                                {status.skipped_count > 0
                                    ? ` · ${t('progress.skippedCount', { count: status.skipped_count })}`
                                    : ''}
                            </p>
                        </div>

                        {status.context_drift && (
                            <div className="flex items-start gap-2 rounded-md border border-warning-300 bg-warning-50 p-3 text-caption text-warning-700">
                                <Warning size={16} className="mt-0.5 shrink-0" />
                                <span>{t('warnings.contextDrift')}</span>
                            </div>
                        )}

                        {status.stale_item_count > 0 && (
                            <div className="flex items-start gap-2 rounded-md border border-warning-300 bg-warning-50 p-3 text-caption text-warning-700">
                                <Warning size={16} className="mt-0.5 shrink-0" />
                                <span>
                                    {t('warnings.staleItems', { count: status.stale_item_count })}
                                </span>
                            </div>
                        )}

                        {status.error_message && (
                            <p className="text-caption text-danger-600">{status.error_message}</p>
                        )}

                        {status.failures.length > 0 && (
                            <div className="flex flex-col gap-2">
                                <button
                                    type="button"
                                    className="flex items-center gap-1 text-caption font-medium text-neutral-600"
                                    onClick={() => setFailuresExpanded((v) => !v)}
                                >
                                    {failuresExpanded ? <CaretUp size={14} /> : <CaretDown size={14} />}
                                    {t('failures.count', { count: status.failures.length })}
                                </button>
                                {failuresExpanded && (
                                    <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border border-neutral-200 p-2">
                                        {status.failures.map((f) => (
                                            <div key={f.attempt_id} className="text-caption text-neutral-600">
                                                <span className="font-medium">{f.student_name || f.attempt_id}</span>
                                                {' — '}
                                                {t('failures.detail', {
                                                    reason: f.reason,
                                                    count: f.retry_count,
                                                })}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="flex flex-wrap items-center gap-2">
                            {status.status === 'COMPLETED' && status.download_url && (
                                <MyButton
                                    type="button"
                                    scale="medium"
                                    buttonType="primary"
                                    disable={isActing}
                                    onClick={() => downloadJob(activeJobId, false)}
                                >
                                    <DownloadSimple size={16} />
                                    {t('downloadZip')}
                                </MyButton>
                            )}
                            {status.resumable && (
                                <MyButton
                                    type="button"
                                    scale="medium"
                                    buttonType="primary"
                                    disable={isActing}
                                    onClick={handleContinue}
                                >
                                    {t('continueButton', { count: status.remaining_count })}
                                </MyButton>
                            )}
                            {status.assemblable && status.status !== 'COMPLETED' && (
                                <MyButton
                                    type="button"
                                    scale="medium"
                                    buttonType="secondary"
                                    disable={isActing}
                                    onClick={() => downloadJob(activeJobId, true)}
                                >
                                    <DownloadSimple size={16} />
                                    {t('downloadCompleted', { count: status.completed_count })}
                                </MyButton>
                            )}
                            {(status.status === 'PENDING' || status.status === 'IN_PROGRESS') && (
                                <MyButton
                                    type="button"
                                    scale="medium"
                                    buttonType="secondary"
                                    disable={isActing}
                                    onClick={handleCancel}
                                >
                                    {t('cancelButton')}
                                </MyButton>
                            )}
                            <MyButton
                                type="button"
                                scale="medium"
                                buttonType="text"
                                onClick={() => setActiveJobId(null)}
                            >
                                {t('startNewExport')}
                            </MyButton>
                        </div>
                        {/* What's inside the ZIP — index.html is the primary
                            entry point; index.csv mentioned as secondary so two
                            index files don't confuse the admin. */}
                        {status.assemblable && (
                            <p className="text-caption text-neutral-500">
                                {t('zipContentsNote.prefix')}{' '}
                                <span className="font-semibold text-neutral-600">index.html</span>{' '}
                                {t('zipContentsNote.suffix')}{' '}
                                <span className="text-neutral-400">
                                    {t('zipContentsNote.csvNote')}
                                </span>
                            </p>
                        )}
                    </div>
                )}

                {!activeJobId && recentQuery.data && recentQuery.data.jobs.length > 0 && (
                    <div className="flex flex-col gap-2 border-t border-neutral-100 pt-4">
                        <p className="text-body font-semibold text-neutral-700">
                            {t('recentExports.title')}
                        </p>
                        {recentQuery.data.jobs.map((job: ReportZipJobSummary) => (
                            <div
                                key={job.job_id}
                                className={cn(
                                    'flex items-center justify-between rounded-md border border-neutral-200 p-3'
                                )}
                            >
                                <div className="flex flex-col gap-1">
                                    <div className="flex items-center gap-2">
                                        {statusChipFor(job.status)}
                                        <span className="text-caption text-neutral-500">
                                            {t('recentExports.completedCount', {
                                                completed: job.completed_count,
                                                total: job.total_count,
                                            })}
                                        </span>
                                    </div>
                                    <span className="text-caption text-neutral-400">
                                        {new Date(job.created_at).toLocaleString()}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <MyButton
                                        type="button"
                                        scale="small"
                                        buttonType="text"
                                        onClick={() => setActiveJobId(job.job_id)}
                                    >
                                        {t('recentExports.view')}
                                    </MyButton>
                                    {job.download_url && (
                                        <MyButton
                                            type="button"
                                            scale="small"
                                            buttonType="secondary"
                                            disable={isActing}
                                            onClick={() => downloadJob(job.job_id, false)}
                                        >
                                            <DownloadSimple size={14} />
                                        </MyButton>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </MyDialog>
    );
};
