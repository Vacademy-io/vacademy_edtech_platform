import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStudentSidebar } from '@/routes/manage-students/students-list/-context/selected-student-sidebar-context';
import {
    useLearnerPackagesQuery,
    type PackageDetailDTO,
} from '@/routes/manage-students/students-list/-services/getLearnerPackages';
import { getInstituteId } from '@/constants/helper';
import { MyButton } from '@/components/design-system/button';
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
import { BulkAssignDialog } from '@/routes/manage-students/students-list/-components/enroll-bulk/bulk-assign-dialog/BulkAssignDialog';
import { DeassignCourseDialog } from './deassign-course-dialog';
import { ManageAccessDialog } from './manage-access-dialog';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_LEVELS_BY_INSTITUTE } from '@/constants/urls';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useNavigate } from '@tanstack/react-router';
import { getTerminology, getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import {
    BookOpen,
    CheckCircle,
    ClockCounterClockwise,
    GraduationCap,
    CaretLeft,
    CaretRight,
    Funnel,
    type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import {
    ProfileSectionCard,
    ProfileSkeleton,
    ProfileEmpty,
    ProfileHeroStat,
    ProfileMiniBar,
} from '../profile-ui';
import { EnrollmentWorkflowStatus } from '@/components/shared/workflow/enrollment-workflow-status';

const ITEMS_PER_PAGE = 20;

export const StudentCourses = ({ isSubmissionTab, packageSessionId }: { isSubmissionTab?: boolean; packageSessionId?: string }) => {
    const { t } = useTranslation('manageStudentsCourses');
    const { selectedStudent } = useStudentSidebar();
    const instituteId = getInstituteId();
    const userId = isSubmissionTab ? selectedStudent?.id || '' : selectedStudent?.user_id || '';
    // The side view already knows who this is, so the enrolment wizard can skip its
    // learner step and go straight to picking the course and invite.
    const assignLearner = {
        userId,
        email: selectedStudent?.email || '',
        name: selectedStudent?.full_name || '',
    };
    const { getDetailsFromPackageSessionId } = useInstituteDetailsStore();
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const [assignOpen, setAssignOpen] = useState(false);
    const [deassignOpen, setDeassignOpen] = useState(false);
    const [manageAccessOpen, setManageAccessOpen] = useState(false);
    const [selectedLevelIds, setSelectedLevelIds] = useState<string[]>([]);
    const [levelMenuOpen, setLevelMenuOpen] = useState(false);
    const [progressPage, setProgressPage] = useState(0);
    const [completedPage, setCompletedPage] = useState(0);
    const [pastPage, setPastPage] = useState(0);

    const levelIds = selectedLevelIds;
    const packageSessionIds = packageSessionId ? [packageSessionId] : [];

    const {
        data: progressCourses,
        isLoading: isLoadingProgress,
    } = useLearnerPackagesQuery({
        instituteId: instituteId || '',
        userId,
        type: 'PROGRESS',
        page: progressPage,
        size: ITEMS_PER_PAGE,
        levelIds,
        packageSessionIds,
    });

    const {
        data: completedCourses,
        isLoading: isLoadingCompleted,
    } = useLearnerPackagesQuery({
        instituteId: instituteId || '',
        userId,
        type: 'COMPLETED',
        page: completedPage,
        size: ITEMS_PER_PAGE,
        levelIds,
        packageSessionIds,
    });

    const {
        data: pastCourses,
        isLoading: isLoadingPast,
    } = useLearnerPackagesQuery({
        instituteId: instituteId || '',
        userId,
        type: 'PAST',
        page: pastPage,
        size: ITEMS_PER_PAGE,
        levelIds,
        packageSessionIds,
    });

    const { data: availableLevels = [] } = useQuery<{ id: string; level_name: string }[]>({
        queryKey: ['GET_INSTITUTE_LEVELS', instituteId],
        queryFn: async () => {
            const response = await authenticatedAxiosInstance.get(GET_LEVELS_BY_INSTITUTE, {
                params: { instituteId },
            });
            return response.data;
        },
        staleTime: 300000,
        enabled: !!instituteId,
    });

    if (!selectedStudent || !instituteId) {
        return (
            <ProfileEmpty
                icon={GraduationCap}
                title={t('noStudentSelected.title')}
                hint={t('noStudentSelected.hint')}
            />
        );
    }

    if (isLoadingProgress || isLoadingCompleted || isLoadingPast) {
        return <ProfileSkeleton blocks={3} />;
    }

    const allActiveCourses: PackageDetailDTO[] = [
        ...(progressCourses?.content || []),
        ...(completedCourses?.content || []),
    ];

    // Access management also covers PAST enrollments — an expired learner is exactly the
    // one an admin needs to extend, and they only appear in that bucket. De-assignment
    // deliberately does not, since there is nothing left to remove there.
    // De-duplicated by package session: a course can surface in more than one bucket, and
    // listing it twice would let the admin tick the same enrollment as two separate rows.
    const accessManageableCourses: PackageDetailDTO[] = Array.from(
        new Map(
            [
                ...(progressCourses?.content || []),
                ...(completedCourses?.content || []),
                ...(pastCourses?.content || []),
            ]
                .filter((course) => !!course.package_session_id)
                .map((course) => [course.package_session_id as string, course])
        ).values()
    );

    // Package sessions this learner is enrolled into — used to surface the
    // enrollment workflow run(s) (tick/cross per step) attached to them.
    const learnerPackageSessionIds = Array.from(
        new Set(
            [
                ...(progressCourses?.content || []),
                ...(completedCourses?.content || []),
                ...(pastCourses?.content || []),
            ]
                .map((course) => course.package_session_id)
                .filter((id): id is string => !!id)
        )
    );

    // Hero stat counts — derived from paginated totals (totalElements) when available,
    // falling back to the length of the current page content.
    const progressCount = progressCourses?.totalElements ?? progressCourses?.content?.length ?? 0;
    const completedCount = completedCourses?.totalElements ?? completedCourses?.content?.length ?? 0;
    const pastCount = pastCourses?.totalElements ?? pastCourses?.content?.length ?? 0;
    const totalCount = progressCount + completedCount + pastCount;

    const handleRefresh = () => {
        queryClient.invalidateQueries({ queryKey: ['GET_LEARNER_PACKAGES'] });
    };

    const handleCourseClick = (course: PackageDetailDTO) => {
        const courseId = course.id;
        const levelId = course.level_id || 'DEFAULT';
        let sessionId: string | undefined;

        if (course.package_session_id) {
            const batchDetails = getDetailsFromPackageSessionId({
                packageSessionId: course.package_session_id,
            });
            if (batchDetails) {
                sessionId = batchDetails.session.id;
            }
        }

        // Land on the full Course Details page (layout sidebar + course
        // header / tabs), the same experience users get when opening a course
        // from the study-library list — not the stripped `/subjects`
        // deep-link.
        navigate({
            to: '/study-library/courses/course-details',
            search: { courseId, levelId, sessionId },
        });
    };

    // Reset all three section pages whenever the level filter changes — the
    // result sets shift, so stale page indices would point past the new data.
    const resetPages = () => {
        setProgressPage(0);
        setCompletedPage(0);
        setPastPage(0);
    };
    // Multi-select: toggle a level in/out of the filter set.
    const toggleLevel = (levelId: string) => {
        setSelectedLevelIds((prev) =>
            prev.includes(levelId) ? prev.filter((id) => id !== levelId) : [...prev, levelId]
        );
        resetPages();
    };
    // "All" clears the filter set (empty = no level filter applied).
    const clearLevels = () => {
        setSelectedLevelIds([]);
        resetPages();
    };

    const courseTermSingular = getTerminology(ContentTerms.Course, SystemTerms.Course);
    const courseTermPlural = getTerminologyPlural(ContentTerms.Course, SystemTerms.Course);

    // When there are no courses at all, show a dedicated empty state with primary action.
    if (totalCount === 0 && !isLoadingProgress && !isLoadingCompleted && !isLoadingPast) {
        return (
            <div className="flex flex-col gap-3">
                <ProfileEmpty
                    icon={BookOpen}
                    title={t('emptyState.title', { term: courseTermPlural.toLowerCase() })}
                    hint={t('emptyState.hint')}
                    action={
                        <>
                            <MyButton
                                buttonType="primary"
                                scale="small"
                                onClick={() => setAssignOpen(true)}
                            >
                                {t('actions.assignToCourse', { term: courseTermSingular })}
                            </MyButton>
                            <BulkAssignDialog
                                open={assignOpen}
                                onOpenChange={setAssignOpen}
                                onSuccess={handleRefresh}
                                initialLearner={assignLearner}
                            />
                        </>
                    }
                />
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3">
            {/* Hero stat grid — passive counters per handoff CoursesSection.
                Click-to-filter has been dropped: the 3 sections below always
                render, so these tiles are purely orientation/status read-outs. */}
            <div className="grid grid-cols-3 gap-2">
                <ProfileHeroStat
                    label={t('heroStats.inProgress')}
                    value={progressCount}
                    tone="primary"
                    icon={BookOpen}
                />
                <ProfileHeroStat
                    label={t('heroStats.completed')}
                    value={completedCount}
                    tone="success"
                    icon={CheckCircle}
                />
                <ProfileHeroStat
                    label={t('heroStats.past')}
                    value={pastCount}
                    tone="neutral"
                    icon={ClockCounterClockwise}
                />
            </div>

            {/* Combined action + filter row per handoff — Assign / Remove
                buttons sit alongside the level filter chips so the controls
                are one mental group, not two stacked bars. */}
            <div className="flex flex-wrap items-center gap-2">
                <MyButton
                    buttonType="primary"
                    scale="small"
                    onClick={() => setAssignOpen(true)}
                >
                    {t('actions.assignToCourse', { term: courseTermSingular })}
                </MyButton>
                <MyButton
                    buttonType="secondary"
                    scale="small"
                    onClick={() => setDeassignOpen(true)}
                    disable={allActiveCourses.length === 0}
                >
                    {t('actions.removeFromCourse', { term: courseTermSingular })}
                </MyButton>
                <MyButton
                    buttonType="secondary"
                    scale="small"
                    onClick={() => setManageAccessOpen(true)}
                    disable={accessManageableCourses.length === 0}
                >
                    {t('actions.manageAccess')}
                </MyButton>
                {availableLevels.length > 0 && (
                    // Collapsed by default into a Filter button; the level list
                    // opens in a dropdown so a long list of levels no longer eats
                    // vertical space in the panel.
                    // - modal={false}: a modal dropdown re-dispatches the click as
                    //   it tears down, which was closing the side-view panel. Non-modal
                    //   avoids the body pointer-lock + that stray click.
                    // - onSelect preventDefault on each item keeps the menu open so
                    //   multiple levels can be toggled in one go.
                    <DropdownMenu
                        open={levelMenuOpen}
                        onOpenChange={setLevelMenuOpen}
                        modal={false}
                    >
                        <DropdownMenuTrigger asChild>
                            <MyButton buttonType="secondary" scale="small" className="ml-auto">
                                <Funnel className="size-3.5" />
                                {selectedLevelIds.length > 0
                                    ? t('actions.filterCount', { count: selectedLevelIds.length })
                                    : t('actions.filter')}
                            </MyButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            align="end"
                            className="max-h-72 w-56 overflow-y-auto"
                        >
                            <DropdownMenuCheckboxItem
                                checked={selectedLevelIds.length === 0}
                                onCheckedChange={() => clearLevels()}
                                onSelect={(e) => e.preventDefault()}
                            >
                                {t('actions.allLevels')}
                            </DropdownMenuCheckboxItem>
                            {availableLevels.map((level) => (
                                <DropdownMenuCheckboxItem
                                    key={level.id}
                                    checked={selectedLevelIds.includes(level.id)}
                                    onCheckedChange={() => toggleLevel(level.id)}
                                    onSelect={(e) => e.preventDefault()}
                                >
                                    {level.level_name}
                                </DropdownMenuCheckboxItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>

            {/* All three sections render unconditionally per handoff —
                counsellors see the full enrolment story without toggling. */}
            <InProgressSection
                courseTermPlural={courseTermPlural}
                courses={progressCourses?.content || []}
                page={progressPage}
                totalPages={progressCourses?.totalPages || 0}
                onPageChange={setProgressPage}
                onCourseClick={handleCourseClick}
                getSessionName={(course) => {
                    if (!course.package_session_id) return null;
                    const details = getDetailsFromPackageSessionId({ packageSessionId: course.package_session_id });
                    return details?.session.session_name || null;
                }}
            />

            <CourseSection
                title={t('sections.completedTitle', { term: courseTermPlural })}
                icon={CheckCircle}
                courses={completedCourses?.content || []}
                emptyMessage={t('sections.noneCompleted', { term: courseTermPlural.toLowerCase() })}
                onCourseClick={handleCourseClick}
                getSessionName={(course) => {
                    if (!course.package_session_id) return null;
                    const details = getDetailsFromPackageSessionId({ packageSessionId: course.package_session_id });
                    return details?.session.session_name || null;
                }}
                renderBadge={(course) => (
                    <div className="flex shrink-0 items-center gap-1.5">
                        {course.level_name && (
                            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium capitalize text-neutral-600">
                                {course.level_name}
                            </span>
                        )}
                        <span className="rounded-full bg-success-50 px-2 py-0.5 text-xs font-medium text-success-700">
                            {t('sections.completedBadge')}
                        </span>
                    </div>
                )}
                page={completedPage}
                totalPages={completedCourses?.totalPages || 0}
                onPageChange={setCompletedPage}
            />

            <CourseSection
                title={t('sections.pastTitle', { term: courseTermPlural })}
                icon={GraduationCap}
                courses={pastCourses?.content || []}
                emptyMessage={t('sections.nonePast', { term: courseTermPlural.toLowerCase() })}
                onCourseClick={handleCourseClick}
                getSessionName={(course) => {
                    if (!course.package_session_id) return null;
                    const details = getDetailsFromPackageSessionId({ packageSessionId: course.package_session_id });
                    return details?.session.session_name || null;
                }}
                renderBadge={(course) =>
                    course.level_name ? (
                        <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium capitalize text-neutral-600">
                            {course.level_name}
                        </span>
                    ) : null
                }
                page={pastPage}
                totalPages={pastCourses?.totalPages || 0}
                onPageChange={setPastPage}
            />

            {/* Enrollment workflow run(s) for this learner's enrolments — shown
                after the course info per handoff; renders nothing when no
                workflow is attached. */}
            <EnrollmentWorkflowStatus
                instituteId={instituteId}
                packageSessionIds={learnerPackageSessionIds}
            />

            {/* Dialogs */}
            <BulkAssignDialog
                open={assignOpen}
                onOpenChange={setAssignOpen}
                onSuccess={handleRefresh}
                initialLearner={assignLearner}
            />
            <DeassignCourseDialog
                userId={userId}
                userName={selectedStudent?.full_name || t('fallbackStudentName')}
                courses={allActiveCourses}
                open={deassignOpen}
                onOpenChange={setDeassignOpen}
                onSuccess={handleRefresh}
            />
            <ManageAccessDialog
                userId={userId}
                userName={selectedStudent?.full_name || t('fallbackStudentName')}
                courses={accessManageableCourses}
                open={manageAccessOpen}
                onOpenChange={setManageAccessOpen}
                onSuccess={handleRefresh}
            />
        </div>
    );
};

/**
 * How much course access is left, from ssigm.expiry_date. Absent expiry means the plan
 * granted unlimited access, which is a real state worth naming — a blank row would read
 * as "not loaded yet".
 */
const AccessWindowLabel = ({ expiryDate }: { expiryDate?: string | null }) => {
    const { t, i18n } = useTranslation('manageStudentsCourses');

    if (!expiryDate) {
        return <span className="text-xs text-neutral-500">{t('accessWindow.unlimited')}</span>;
    }

    const expiry = new Date(expiryDate);
    if (Number.isNaN(expiry.getTime())) return null;

    const daysLeft = Math.ceil((expiry.getTime() - Date.now()) / 86_400_000);
    const expired = daysLeft <= 0;
    // Two weeks is roughly the window in which an admin can still act on a renewal
    // before the learner is locked out, so that is where the row starts warning.
    const expiringSoon = !expired && daysLeft <= 14;

    return (
        <span
            className={cn(
                'text-xs',
                expired
                    ? 'font-medium text-danger-600'
                    : expiringSoon
                      ? 'font-medium text-warning-600'
                      : 'text-neutral-500'
            )}
        >
            {expired
                ? t('accessWindow.expired', { date: expiry.toLocaleDateString(i18n.language) })
                : t('accessWindow.daysLeft', { date: expiry.toLocaleDateString(i18n.language), count: daysLeft })}
        </span>
    );
};

// ── In Progress section (hero visual weight, ProfileMiniBar per row) ───────────

const InProgressSection = ({
    courseTermPlural,
    courses,
    page,
    totalPages,
    onPageChange,
    onCourseClick,
    getSessionName,
}: {
    courseTermPlural: string;
    courses: PackageDetailDTO[];
    page: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    onCourseClick: (course: PackageDetailDTO) => void;
    getSessionName: (course: PackageDetailDTO) => string | null;
}) => {
    const { t } = useTranslation('manageStudentsCourses');
    const sessionTermSingular = getTerminology(ContentTerms.Session, SystemTerms.Session);

    return (
        <ProfileSectionCard icon={BookOpen} heading={t('sections.inProgressTitle', { term: courseTermPlural })}>
            {courses.length > 0 ? (
                <div className="flex flex-col gap-2">
                    {courses.map((course) => {
                        const sessionName = getSessionName(course);
                        const pct = Math.min(Math.max(course.percentage_completed ?? 0, 0), 100);
                        return (
                            <button
                                type="button"
                                key={course.id + (course.package_session_id || '')}
                                onClick={() => onCourseClick(course)}
                                className="flex w-full flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3 text-left transition-shadow hover:border-primary-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                            >
                                {/* Single-line summary per handoff: name (flex-1)
                                    + level badge + percentage chip. Per-row
                                    Trash removed — Remove from {course} lives
                                    in the top action bar. */}
                                <div className="flex min-w-0 items-center gap-2">
                                    <p
                                        className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-800"
                                        title={course.package_name || t('course.unnamed')}
                                    >
                                        {course.package_name || t('course.unnamed')}
                                    </p>
                                    {course.level_name && (
                                        <span className="shrink-0 rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium capitalize text-primary-700">
                                            {course.level_name}
                                        </span>
                                    )}
                                    <span className="shrink-0 tabular-nums text-sm font-semibold text-card-foreground">
                                        {pct}%
                                    </span>
                                </div>
                                {sessionName && (
                                    <span className="text-xs text-neutral-500">
                                        {t('course.sessionLabel', { term: sessionTermSingular, name: sessionName })}
                                    </span>
                                )}
                                <AccessWindowLabel expiryDate={course.expiry_date} />
                                {/* Progress mini-bar */}
                                <ProfileMiniBar value={pct} />
                            </button>
                        );
                    })}

                    {totalPages > 1 && (
                        <div className="flex items-center justify-center gap-2 pt-1">
                            <MyButton
                                buttonType="text"
                                scale="small"
                                onClick={() => onPageChange(page - 1)}
                                disable={page === 0}
                            >
                                <CaretLeft className="size-3.5" />
                                {t('pagination.prev')}
                            </MyButton>
                            <span className="text-xs text-neutral-500">
                                {page + 1} / {totalPages}
                            </span>
                            <MyButton
                                buttonType="text"
                                scale="small"
                                onClick={() => onPageChange(page + 1)}
                                disable={page >= totalPages - 1}
                            >
                                {t('pagination.next')}
                                <CaretRight className="size-3.5" />
                            </MyButton>
                        </div>
                    )}
                </div>
            ) : (
                <ProfileEmpty
                    icon={BookOpen}
                    title={t('sections.noneInProgress', { term: courseTermPlural.toLowerCase() })}
                />
            )}
        </ProfileSectionCard>
    );
};

// ── Generic course section (Completed / Past — less visual weight) ─────────────

const CourseSection = ({
    title,
    icon,
    courses,
    emptyMessage,
    renderBadge,
    page,
    totalPages,
    onPageChange,
    onCourseClick,
    getSessionName,
}: {
    title: string;
    icon: PhosphorIcon;
    courses: PackageDetailDTO[];
    emptyMessage: string;
    renderBadge: (course: PackageDetailDTO) => React.ReactNode;
    page: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    onCourseClick?: (course: PackageDetailDTO) => void;
    getSessionName?: (course: PackageDetailDTO) => string | null;
}) => {
    const { t } = useTranslation('manageStudentsCourses');
    const sessionTermSingular = getTerminology(ContentTerms.Session, SystemTerms.Session);

    return (
        <ProfileSectionCard icon={icon} heading={title}>
            {courses.length > 0 ? (
                <div className="flex flex-col gap-2">
                    {courses.map((course) => {
                        const sessionName = getSessionName?.(course);
                        return (
                            <button
                                key={course.id + (course.package_session_id || '')}
                                type="button"
                                className={cn(
                                    'flex w-full flex-col rounded-lg border border-neutral-200 bg-white p-3 text-left transition-shadow',
                                    onCourseClick && 'cursor-pointer hover:border-primary-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400'
                                )}
                                onClick={() => onCourseClick?.(course)}
                            >
                                <div className="flex min-w-0 items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p
                                            className="truncate text-sm font-semibold text-neutral-800"
                                            title={course.package_name || t('course.unnamed')}
                                        >
                                            {course.package_name || t('course.unnamed')}
                                        </p>
                                        {sessionName && (
                                            <p className="mt-0.5 truncate text-xs text-neutral-500">
                                                {t('course.sessionLabel', { term: sessionTermSingular, name: sessionName })}
                                            </p>
                                        )}
                                    </div>
                                    {renderBadge(course)}
                                </div>
                            </button>
                        );
                    })}

                    {totalPages > 1 && (
                        <div className="flex items-center justify-center gap-2 pt-1">
                            <MyButton
                                buttonType="text"
                                scale="small"
                                onClick={() => onPageChange(page - 1)}
                                disable={page === 0}
                            >
                                <CaretLeft className="size-3.5" />
                                {t('pagination.prev')}
                            </MyButton>
                            <span className="text-xs text-neutral-500">
                                {page + 1} / {totalPages}
                            </span>
                            <MyButton
                                buttonType="text"
                                scale="small"
                                onClick={() => onPageChange(page + 1)}
                                disable={page >= totalPages - 1}
                            >
                                {t('pagination.next')}
                                <CaretRight className="size-3.5" />
                            </MyButton>
                        </div>
                    )}
                </div>
            ) : (
                <ProfileEmpty
                    icon={icon}
                    title={emptyMessage}
                />
            )}
        </ProfileSectionCard>
    );
};
