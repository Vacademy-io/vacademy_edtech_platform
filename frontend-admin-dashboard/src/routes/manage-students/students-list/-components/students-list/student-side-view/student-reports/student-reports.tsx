import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useStudentSidebar } from '../../../../-context/selected-student-sidebar-context';
import { InitiateReportDialog } from './InitiateReportDialog';
import {
    getStudentReports,
    getStudentReport,
    getStudentReportFull,
} from '@/services/student-analysis';
import {
    StudentReport,
    StudentReportData,
    ComprehensiveStudentReport,
} from '@/types/student-analysis';
import {
    FileText,
    Clock,
    ArrowRight,
    CaretLeft,
    CaretRight,
    CheckCircle,
    XCircle,
    Spinner,
    CircleNotch,
    type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
import { format } from 'date-fns';
import { StudentReportDetailsDialog } from './StudentReportDetailsDialog';
import { ComprehensiveReportDialog } from './ComprehensiveReportDialog';
import { LearnedFromChatsPanel } from './LearnedFromChatsPanel';
import { MyButton } from '@/components/design-system/button';
import { toast } from 'sonner';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import {
    ProfileSectionCard,
    ProfileSkeleton,
    ProfileEmpty,
    ProfileError,
    ProfileActionBar,
    ProfileHeroStat,
} from '../profile-ui';
import { cn } from '@/lib/utils';

export const StudentReports = () => {
    const { t } = useTranslation('manageStudentsReports');
    const { selectedStudent } = useStudentSidebar();
    const [reports, setReports] = useState<StudentReport[]>([]);
    const [page, setPage] = useState(0);
    const [totalPages, setTotalPages] = useState(0);
    const [loading, setLoading] = useState(false);
    const [fetchError, setFetchError] = useState(false);

    // V1 dialog state
    const [selectedReport, setSelectedReport] = useState<StudentReportData | null>(null);
    const [selectedReportName, setSelectedReportName] = useState<string | undefined>(undefined);
    const [detailsOpen, setDetailsOpen] = useState(false);

    // V2 dialog state
    const [comprehensiveReport, setComprehensiveReport] =
        useState<ComprehensiveStudentReport | null>(null);
    const [comprehensiveProcessId, setComprehensiveProcessId] = useState<string | null>(null);
    const [comprehensiveReportName, setComprehensiveReportName] = useState<string | undefined>(
        undefined
    );
    const [comprehensiveOpen, setComprehensiveOpen] = useState(false);

    // Per-row loading: stores the processId currently being fetched
    const [viewLoading, setViewLoading] = useState<string | null>(null);

    const [pendingProcesses, setPendingProcesses] = useState<string[]>([]);
    const [statusCheckLoading, setStatusCheckLoading] = useState(false);

    const checkPendingProcesses = () => {
        const storedProcesses = sessionStorage.getItem('student_analysis_processes');
        if (storedProcesses) {
            try {
                const processes: string[] = JSON.parse(storedProcesses);
                setPendingProcesses(processes);
            } catch (e) {
                console.error('Error parsing student_analysis_processes', e);
                setPendingProcesses([]);
            }
        } else {
            setPendingProcesses([]);
        }
    };

    useEffect(() => {
        checkPendingProcesses();
    }, []);

    const fetchReports = async () => {
        if (!selectedStudent?.user_id) return;
        setLoading(true);
        setFetchError(false);
        try {
            const response = await getStudentReports(
                selectedStudent.user_id,
                selectedStudent.institute_id,
                page,
                5
            );
            setReports(response.reports);
            setTotalPages(response.total_pages);

            // Cleanup session storage for completed processes
            const storedProcesses = sessionStorage.getItem('student_analysis_processes');
            if (storedProcesses) {
                try {
                    const processes: string[] = JSON.parse(storedProcesses);
                    const completedProcessIds = new Set(response.reports.map((r) => r.process_id));
                    const remainingProcesses = processes.filter(
                        (id) => !completedProcessIds.has(id)
                    );

                    if (remainingProcesses.length !== processes.length) {
                        if (remainingProcesses.length > 0) {
                            sessionStorage.setItem(
                                'student_analysis_processes',
                                JSON.stringify(remainingProcesses)
                            );
                        } else {
                            sessionStorage.removeItem('student_analysis_processes');
                        }
                        setPendingProcesses(remainingProcesses);
                    }
                } catch (e) {
                    console.error('Error parsing student_analysis_processes', e);
                }
            }
        } catch (error) {
            console.error('Failed to fetch reports:', error);
            setFetchError(true);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchReports();
    }, [selectedStudent?.user_id, page]);

    const handlePageChange = (newPage: number) => {
        if (newPage >= 0 && newPage < totalPages) {
            setPage(newPage);
        }
    };

    /**
     * Fetch the full report by processId, then dispatch to the correct dialog
     * depending on report_version.
     */
    const handleViewDetails = async (processId: string) => {
        setViewLoading(processId);
        try {
            const full = await getStudentReportFull(processId);
            if (full.report_version === 'v2' && full.comprehensive_report) {
                setComprehensiveReport(full.comprehensive_report);
                setComprehensiveProcessId(processId);
                setComprehensiveReportName(full.name);
                setComprehensiveOpen(true);
            } else {
                // Fallback: v1 or missing version → open old dialog
                const reportData = full.report;
                if (reportData) {
                    setSelectedReport(reportData);
                    setSelectedReportName(full.name);
                    setDetailsOpen(true);
                } else {
                    toast.error(t('toast.reportDataNotAvailable'));
                }
            }
        } catch (error) {
            console.error('Failed to fetch report details:', error);
            toast.error(t('toast.loadDetailsFailed'));
        } finally {
            setViewLoading(null);
        }
    };

    const handleCheckStatus = async () => {
        setStatusCheckLoading(true);
        try {
            const storedProcesses = sessionStorage.getItem('student_analysis_processes');
            if (!storedProcesses) return;

            const processes: string[] = JSON.parse(storedProcesses);
            const remainingProcesses: string[] = [];
            let hasUpdates = false;
            let stillPendingCount = 0;
            let completedCount = 0;
            let failedCount = 0;

            for (const processId of processes) {
                try {
                    const report = await getStudentReport(processId);
                    if (report.status === 'COMPLETED') {
                        hasUpdates = true;
                        completedCount++;
                    } else if (report.status === 'FAILED') {
                        hasUpdates = true;
                        failedCount++;
                    } else {
                        remainingProcesses.push(processId);
                        stillPendingCount++;
                    }
                } catch (error) {
                    console.error(`Error checking status for ${processId}`, error);
                    remainingProcesses.push(processId);
                }
            }

            if (hasUpdates) {
                fetchReports();
                if (remainingProcesses.length > 0) {
                    sessionStorage.setItem(
                        'student_analysis_processes',
                        JSON.stringify(remainingProcesses)
                    );
                } else {
                    sessionStorage.removeItem('student_analysis_processes');
                }
                setPendingProcesses(remainingProcesses);
            }

            if (completedCount > 0) {
                toast.success(t('toast.reportsCompleted', { count: completedCount }));
            }
            if (failedCount > 0) {
                toast.error(t('toast.reportsFailed', { count: failedCount }));
            }
            if (stillPendingCount > 0) {
                toast.info(t('toast.reportsPending', { count: stillPendingCount }));
            }
        } catch (error) {
            console.error('Error checking statuses:', error);
            toast.error(t('toast.checkStatusFailed'));
        } finally {
            setStatusCheckLoading(false);
        }
    };

    const reportLabel = getTerminology(RoleTerms.Learner, SystemTerms.Learner);

    const processingCount =
        reports.filter((r) => r.status === 'PROCESSING').length + pendingProcesses.length;
    const completedCount = reports.filter((r) => r.status === 'COMPLETED').length;
    const failedCount = reports.filter((r) => r.status === 'FAILED').length;

    // Groups: Processing first (most actionable), then Completed, then Failed
    const GROUP_ORDER = ['PROCESSING', 'COMPLETED', 'FAILED'] as const;
    const groupedReports = GROUP_ORDER.map((status) => ({
        status,
        items: reports.filter((r) => r.status === status),
    })).filter((g) => g.items.length > 0);

    return (
        <div className="flex flex-col gap-3 text-neutral-600">
            {/* Primary action bar */}
            <ProfileActionBar className="justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                    {t('actionBar.title', { label: reportLabel })}
                </span>
                <div className="flex gap-2">
                    {pendingProcesses.length > 0 && (
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            onClick={handleCheckStatus}
                            disabled={statusCheckLoading}
                        >
                            <Clock className="size-3.5" />
                            {statusCheckLoading ? t('actionBar.checking') : t('actionBar.checkStatus')}
                        </MyButton>
                    )}
                    <InitiateReportDialog
                        onSuccess={() => {
                            fetchReports();
                            checkPendingProcesses();
                        }}
                    />
                </div>
            </ProfileActionBar>

            {selectedStudent?.user_id && <LearnedFromChatsPanel userId={selectedStudent.user_id} />}

            {/* Hero stat tiles — visible once data is loaded and there are reports */}
            {!loading && !fetchError && reports.length > 0 && (
                <div className="flex gap-2">
                    <ProfileHeroStat
                        label={t('status.processing')}
                        value={processingCount}
                        tone={processingCount > 0 ? 'warning' : 'neutral'}
                        icon={Spinner as PhosphorIcon}
                    />
                    <ProfileHeroStat
                        label={t('status.completed')}
                        value={completedCount}
                        tone={completedCount > 0 ? 'success' : 'neutral'}
                        icon={CheckCircle as PhosphorIcon}
                    />
                    <ProfileHeroStat
                        label={t('status.failed')}
                        value={failedCount}
                        tone={failedCount > 0 ? 'danger' : 'neutral'}
                        icon={XCircle as PhosphorIcon}
                    />
                </div>
            )}

            {/* Loading state */}
            {loading ? (
                <ProfileSkeleton blocks={3} />
            ) : fetchError ? (
                /* Error state */
                <ProfileError
                    title={t('error.title')}
                    hint={t('error.hint')}
                    onRetry={fetchReports}
                />
            ) : reports.length === 0 ? (
                /* Empty state */
                <ProfileEmpty
                    icon={FileText as PhosphorIcon}
                    title={t('empty.title')}
                    hint={t('empty.hint')}
                    action={<InitiateReportDialog onSuccess={fetchReports} />}
                />
            ) : (
                /* Report cards grouped by status */
                <div className="flex flex-col gap-4">
                    {groupedReports.map(({ status, items }) => (
                        <div key={status} className="flex flex-col gap-2">
                            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                                {status === 'PROCESSING'
                                    ? t('status.processing')
                                    : status === 'COMPLETED'
                                      ? t('status.completed')
                                      : t('status.failed')}
                            </span>
                            {items.map((report) => (
                                <ProfileSectionCard
                                    key={report.process_id}
                                    icon={FileText as PhosphorIcon}
                                    heading={
                                        report.name ||
                                        `${format(new Date(report.start_date_iso), 'MMM d')} – ${format(new Date(report.end_date_iso), 'MMM d, yyyy')}`
                                    }
                                    action={
                                        report.status === 'COMPLETED' ? (
                                            <MyButton
                                                buttonType="secondary"
                                                scale="small"
                                                onClick={() => handleViewDetails(report.process_id)}
                                                disabled={viewLoading === report.process_id}
                                            >
                                                {viewLoading === report.process_id ? (
                                                    <CircleNotch className="size-3.5 animate-spin" />
                                                ) : (
                                                    <ArrowRight className="size-3.5" />
                                                )}
                                                {viewLoading === report.process_id
                                                    ? t('card.loading')
                                                    : t('card.view')}
                                            </MyButton>
                                        ) : undefined
                                    }
                                >
                                    <div className="flex items-center gap-1.5">
                                        <Clock className="size-3.5 text-neutral-400" />
                                        <span className="text-xs text-neutral-500">
                                            {t('card.createdOn', {
                                                date: format(
                                                    new Date(report.created_at),
                                                    'MMM d, yyyy'
                                                ),
                                            })}
                                        </span>
                                        <span
                                            className={cn(
                                                'ml-auto inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1',
                                                report.status === 'COMPLETED'
                                                    ? 'bg-success-50 text-success-700 ring-success-200'
                                                    : report.status === 'FAILED'
                                                      ? 'bg-danger-50 text-danger-700 ring-danger-200'
                                                      : 'bg-warning-50 text-warning-700 ring-warning-200'
                                            )}
                                        >
                                            {report.status === 'COMPLETED'
                                                ? t('status.completed')
                                                : report.status === 'FAILED'
                                                  ? t('status.failed')
                                                  : t('status.processing')}
                                        </span>
                                    </div>
                                </ProfileSectionCard>
                            ))}
                        </div>
                    ))}
                </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="mt-1 flex items-center justify-center gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        onClick={() => handlePageChange(page - 1)}
                        disabled={page === 0}
                    >
                        <CaretLeft className="size-3.5" />
                    </MyButton>
                    <span className="text-xs font-medium text-neutral-600">
                        {t('pagination.pageOf', { page: page + 1, total: totalPages })}
                    </span>
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        onClick={() => handlePageChange(page + 1)}
                        disabled={page === totalPages - 1}
                    >
                        <CaretRight className="size-3.5" />
                    </MyButton>
                </div>
            )}

            {/* V1 dialog */}
            <StudentReportDetailsDialog
                open={detailsOpen}
                onOpenChange={setDetailsOpen}
                report={selectedReport}
                title={selectedReportName || t('card.defaultTitle')}
            />

            {/* V2 comprehensive dialog */}
            <ComprehensiveReportDialog
                open={comprehensiveOpen}
                onOpenChange={setComprehensiveOpen}
                processId={comprehensiveProcessId}
                report={comprehensiveReport}
                reportName={comprehensiveReportName}
            />
        </div>
    );
};
