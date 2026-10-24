import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyButton } from '@/components/design-system/button';
import { ChipToggleGroup, StatusChips } from '@/components/design-system/chips';
import { TestReportDialog } from './test-report-dialog';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useStudentSidebar } from '@/routes/manage-students/students-list/-context/selected-student-sidebar-context';
import { convertToLocalDateTime, extractDateTime, getInstituteId } from '@/constants/helper';
import {
    getStudentReport,
    handleStudentReportData,
    viewStudentReport,
} from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/assessment-details-services';
import { MyPagination } from '@/components/design-system/pagination';
import {
    resolveSubjectName,
    unresolvedSubjectIds,
    useSubjectNamesByIds,
} from '@/services/subject-names';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { AssessmentReportStudentInterface } from '@/types/assessments/assessment-overview';
import { getAssessmentDetailsData } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-services/assessment-services';
import { Steps } from '@/types/assessments/assessment-data-type';
import {
    Trophy,
    CheckCircle,
    Clock,
    Radio,
} from '@phosphor-icons/react';
import {
    ProfileSkeleton,
    ProfileEmpty,
    ProfileError,
    ProfileHero,
} from '../profile-ui';

export interface StudentReportFilterInterface {
    name: string;
    status: string[];
    sort_columns: Record<string, string>;
}

// ── Score-tone helper ─────────────────────────────────────────────────────────
// Derives a tone class from the raw score percentage.
// >=80 → success, >=50 → primary, >=30 → warning, else → danger
type ScoreTone = 'success' | 'primary' | 'warning' | 'danger';

function scoreTone(pct: number): ScoreTone {
    if (pct >= 80) return 'success';
    if (pct >= 50) return 'primary';
    if (pct >= 30) return 'warning';
    return 'danger';
}

// Filter chip definitions — drives the secondary control bar.
type FilterKey = 'ALL' | 'ENDED' | 'PENDING' | 'LIVE';

type FilterChip = {
    key: FilterKey;
    label: string;
    statuses: string[];
    icon?: React.ComponentType<{ className?: string }>;
};

function buildFilterChips(t: TFunction): FilterChip[] {
    return [
        { key: 'ALL', label: t('filters.all'), statuses: [] },
        { key: 'ENDED', label: t('filters.completed'), statuses: ['ENDED'], icon: CheckCircle },
        { key: 'PENDING', label: t('filters.pending'), statuses: ['PENDING'], icon: Clock },
        { key: 'LIVE', label: t('filters.live'), statuses: ['LIVE'], icon: Radio },
    ];
}

export const StudentTestRecord = ({
    selectedTab,
    examType,
    isStudentList = false,
}: {
    selectedTab: string | undefined;
    examType: string | undefined;
    isStudentList?: boolean;
}) => {
    const { t } = useTranslation('manageStudentsTestRecord');
    const FILTER_CHIPS = buildFilterChips(t);

    // Institute data with error handling
    const {
        data: instituteDetails,
        isLoading: instituteLoading,
        error: instituteError,
        refetch: refetchInstitute,
    } = useQuery(useInstituteQuery());

    const [selectedFilter] = useState<StudentReportFilterInterface>({
        name: '',
        // The side-view / overlay drives status via the chip bar, which defaults
        // to "All". So fetch every status up front — otherwise the initial query
        // would be scoped to a single status (e.g. LIVE when no tab is passed) and
        // "All" could never show Pending + Completed. The students-list "Tests" tab
        // keeps its own comma-separated status selection.
        status: isStudentList ? (selectedTab ?? '').split(',') : ['ENDED', 'PENDING', 'LIVE'],
        sort_columns: {},
    });
    const { selectedStudent } = useStudentSidebar();

    const [pageNo, setPageNo] = useState(0);
    const instituteId = getInstituteId();

    // Active filter chip — drives filter chip bar; updates mutation on change
    const [activeFilter, setActiveFilter] = useState<FilterKey>('ALL');

    // Student report data with error handling
    const {
        data,
        isLoading,
        error: reportError,
        refetch: refetchReport,
    } = useQuery({
        ...handleStudentReportData({
            studentId: selectedStudent?.id,
            instituteId,
            pageNo,
            pageSize: 10,
            selectedFilter,
        }),
        // eslint-disable-next-line
        retry: (failureCount, error: any) => {
            if (error?.response?.status === 403) return false;
            return failureCount < 2;
        },
        retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    });

    const [studentReportData, setStudentReportData] = useState(
        data || { content: [], total_pages: 0 }
    );

    const [selectedTest, setSelectedTest] = useState(null);
    const [assessmentDetails, setAssessmentDetails] = useState<Steps | null>(null);

    const handlePageChange = (newPage: number) => {
        setPageNo(newPage);
        getStudentReportMutation.mutate({
            studentId: selectedStudent?.id,
            instituteId,
            pageNo: newPage,
            pageSize: 10,
            selectedFilter,
        });
    };

    const viewStudentTestReportMutation = useMutation({
        mutationFn: ({
            assessmentId,
            attemptId,
            instituteId,
        }: {
            assessmentId: string;
            attemptId: string;
            instituteId: string | undefined;
        }) => viewStudentReport(assessmentId, attemptId, instituteId),
        onSuccess: async (data, { assessmentId }) => {
            setSelectedTest(data);
            try {
                const assessData = await getAssessmentDetailsData({
                    assessmentId: assessmentId,
                    instituteId: instituteDetails?.id,
                    type: examType,
                });
                setAssessmentDetails(assessData);
            } catch (error) {
                console.error('Failed to fetch assessment details:', error);
            }
        },
        // eslint-disable-next-line
        onError: (error: any) => {
            console.error('Failed to view student report:', error);
        },
    });

    const [selectedStudentReport, setSelectedStudentReport] =
        useState<AssessmentReportStudentInterface | null>(null);

    const handleViewReport = (
        assessmentId: string,
        attemptId: string,
        studentReport: AssessmentReportStudentInterface
    ) => {
        setSelectedTest(null);
        setSelectedStudentReport(studentReport);
        viewStudentTestReportMutation.mutate({
            assessmentId,
            attemptId,
            instituteId: instituteDetails?.id,
        });
    };

    const getStudentReportMutation = useMutation({
        mutationFn: ({
            studentId,
            instituteId,
            pageNo,
            pageSize,
            selectedFilter,
        }: {
            studentId: string | undefined;
            instituteId: string | undefined;
            pageNo: number;
            pageSize: number;
            selectedFilter: StudentReportFilterInterface;
        }) => getStudentReport(studentId, instituteId, pageNo, pageSize, selectedFilter),
        onSuccess: (data) => {
            setStudentReportData(data);
        },
        // eslint-disable-next-line
        onError: (error: any) => {
            console.error('Failed to fetch student report:', error);
        },
    });

    // Apply filter chip selection — re-fetches with the chosen status array
    const handleFilterChip = (chipKey: FilterKey) => {
        setActiveFilter(chipKey);
        const chip = FILTER_CHIPS.find((c) => c.key === chipKey)!;
        const statusFilter = chip.statuses.length
            ? chip.statuses
            : selectedFilter.status;
        getStudentReportMutation.mutate({
            studentId: selectedStudent?.id,
            instituteId,
            pageNo: 0,
            pageSize: 10,
            selectedFilter: {
                ...selectedFilter,
                status: statusFilter,
            },
        });
        setPageNo(0);
    };

    useEffect(() => {
        if (data) {
            setStudentReportData(data);
        }
    }, [data]);

    // Subject labels. Must run before the guards below (hook order), and cannot come from
    // the institute list alone: that list keeps one subject per distinct name and drops
    // subjects whose course was deleted, so most stored ids need the direct lookup.
    const subjectNamesById = useSubjectNamesByIds(
        unresolvedSubjectIds(
            instituteDetails?.subjects,
            (studentReportData.content ?? []).map(
                (report: AssessmentReportStudentInterface) => report.subject_id
            )
        )
    );

    // ── Four-state guards ──────────────────────────────────────────────────────

    if (isLoading || instituteLoading || viewStudentTestReportMutation.status === 'pending') {
        return <ProfileSkeleton blocks={4} />;
    }

    if (instituteError) {
        // eslint-disable-next-line
        const err = instituteError as any;
        const isUnauthorized = err?.response?.status === 403;
        return (
            <ProfileError
                title={isUnauthorized ? t('common.accessRestricted') : t('errors.institute.title')}
                hint={
                    isUnauthorized
                        ? t('errors.institute.hintRestricted')
                        : t('errors.institute.hint')
                }
                onRetry={isUnauthorized ? undefined : () => refetchInstitute()}
            />
        );
    }

    if (reportError) {
        // eslint-disable-next-line
        const err = reportError as any;
        const isUnauthorized = err?.response?.status === 403;
        return (
            <ProfileError
                title={isUnauthorized ? t('common.accessRestricted') : t('errors.report.title')}
                hint={
                    isUnauthorized
                        ? t('errors.report.hintRestricted')
                        : t('errors.report.hint')
                }
                onRetry={isUnauthorized ? undefined : () => refetchReport()}
            />
        );
    }

    const allRecords: AssessmentReportStudentInterface[] = studentReportData.content ?? [];

    // ── Derived stat values ────────────────────────────────────────────────────
    const attemptedRecords = allRecords.filter((r) => r.attempt_status === 'ENDED');
    const attemptedCount = attemptedRecords.length;

    // Avg score: mean of (total_marks) across completed records.
    // total_marks is the raw score; we display it as "X pts avg" since max isn't known per row.
    const avgScore =
        attemptedCount > 0
            ? attemptedRecords.reduce((sum, r) => sum + r.total_marks, 0) / attemptedCount
            : 0;

    // Apply active filter chip client-side for the visible list
    const records: AssessmentReportStudentInterface[] =
        activeFilter === 'ALL'
            ? allRecords
            : allRecords.filter((r) => r.attempt_status === activeFilter);

    return (
        <div className="flex flex-col gap-3">
            {/* ── Hero zone (Vacademy design handoff: TestsSection) ──────────
                Hero is a PASSIVE summary card — the average score IS the
                title, attempt count is the subtitle, no per-row action. */}
            <ProfileHero
                eyebrow={t('hero.eyebrow')}
                icon={Trophy}
                tone={
                    attemptedCount > 0
                        ? (scoreTone(avgScore) as
                              | 'success'
                              | 'primary'
                              | 'warning'
                              | 'danger')
                        : 'neutral'
                }
                title={
                    attemptedCount > 0 ? (
                        <span className="text-subtitle font-semibold leading-none text-card-foreground">
                            {t('hero.avgScore', { score: avgScore.toFixed(1) })}
                        </span>
                    ) : (
                        <span className="text-body font-semibold leading-none text-muted-foreground">
                            {t('hero.noAttempts')}
                        </span>
                    )
                }
                subtitle={
                    attemptedCount > 0
                        ? t('hero.testsRecorded', { count: attemptedCount })
                        : t('hero.testsAssignedHint')
                }
            />

            {/* Stat-tile row removed per design handoff — the avg score is
                already surfaced as the hero title above, and the handoff's
                TestsSection has no separate stat row. */}

            {/* ── Filter chips (no search per handoff) ───────────────────────── */}
            <div className="flex flex-wrap items-center gap-2">
                <ChipToggleGroup<FilterKey>
                    value={activeFilter}
                    onChange={handleFilterChip}
                    options={FILTER_CHIPS.map((c) => ({
                        value: c.key,
                        label: c.label,
                        icon: c.icon,
                    }))}
                    ariaLabel={t('filters.ariaLabel')}
                />
            </div>

            {/* ── Body ──────────────────────────────────────────────────────── */}
            {records.length === 0 ? (
                <ProfileEmpty
                    icon={Trophy}
                    title={t('empty.title')}
                    hint={t('empty.hint')}
                />
            ) : (
                <div className="flex flex-col gap-2.5">
                    {records.map(
                        (studentReport: AssessmentReportStudentInterface, index: number) => {
                            const isEnded = studentReport.attempt_status === 'ENDED';
                            const isPending = studentReport.attempt_status === 'PENDING';

                            const subjectName =
                                resolveSubjectName(
                                    instituteDetails?.subjects,
                                    subjectNamesById,
                                    studentReport.subject_id
                                ) || t('list.subjectFallback');

                            // Subtitle date: prefer attempt_date for ENDED rows,
                            // fall back to scheduled start_time so every card shows
                            // "subject · date" per handoff.
                            const subtitleDateSource = isEnded
                                ? studentReport.attempt_date
                                : studentReport.start_time;
                            const subtitleDate = subtitleDateSource
                                ? extractDateTime(
                                      convertToLocalDateTime(subtitleDateSource)
                                  ).date
                                : '';

                            return (
                                <div
                                    key={index}
                                    className="flex items-center gap-3 rounded-lg border border-border bg-card p-4"
                                >
                                    {/* Left block: name + subject · date */}
                                    <div className="min-w-0 flex-1">
                                        <div
                                            className="block truncate text-h5 font-bold leading-snug text-card-foreground"
                                            title={studentReport.assessment_name}
                                        >
                                            {studentReport.assessment_name}
                                        </div>
                                        <div className="mt-0.5 text-caption text-muted-foreground">
                                            {subjectName}
                                            {subtitleDate && (
                                                <>
                                                    {' · '}
                                                    {subtitleDate}
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    {/* Right block: score (large) + status pill + action */}
                                    <div className="flex shrink-0 flex-col items-end gap-1">
                                        {isEnded && (
                                            <div className="text-h4 font-bold leading-none text-primary-600">
                                                {studentReport.total_marks.toFixed(1)}
                                            </div>
                                        )}
                                        <StatusChips
                                            status={
                                                isPending
                                                    ? 'pending'
                                                    : isEnded
                                                      ? 'Attempted'
                                                      : 'Not Attempted'
                                            }
                                        >
                                            {isPending
                                                ? t('status.pending')
                                                : isEnded
                                                  ? t('status.attempted')
                                                  : t('status.notAttempted')}
                                        </StatusChips>
                                        {isEnded && (
                                            <MyButton
                                                buttonType="text"
                                                scale="small"
                                                layoutVariant="default"
                                                onClick={() =>
                                                    handleViewReport(
                                                        studentReport.assessment_id,
                                                        studentReport.attempt_id,
                                                        studentReport
                                                    )
                                                }
                                            >
                                                {t('actions.viewReport')}
                                            </MyButton>
                                        )}
                                        {isPending && (
                                            <MyButton
                                                buttonType="text"
                                                scale="small"
                                                layoutVariant="default"
                                            >
                                                {t('actions.sendReminder')}
                                            </MyButton>
                                        )}
                                    </div>
                                </div>
                            );
                        }
                    )}
                </div>
            )}

            {/* Report dialog — hoisted outside the list so only one instance renders */}
            {selectedTest && selectedStudentReport && (
                <TestReportDialog
                    isOpen={!!selectedTest}
                    onClose={() => {
                        setSelectedTest(null);
                        setSelectedStudentReport(null);
                    }}
                    testReport={selectedTest}
                    studentReport={selectedStudentReport}
                    assessmentDetails={assessmentDetails!}
                />
            )}

            {/* ── Pagination ────────────────────────────────────────────────── */}
            {studentReportData.total_pages > 1 && (
                <div className="flex justify-center pt-2">
                    <MyPagination
                        currentPage={pageNo}
                        totalPages={studentReportData.total_pages}
                        onPageChange={handlePageChange}
                    />
                </div>
            )}
        </div>
    );
};
