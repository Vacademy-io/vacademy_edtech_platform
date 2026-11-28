import { MyPagination } from '@/components/design-system/pagination';
import { usePaginationState } from '@/hooks/pagination';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { StudentSearchBox } from '@/components/common/student-search-box';
import { ActivityLogDialog } from '@/components/common/student-slide-tracking/activity-log-dialog';
import { Dialog, DialogHeader, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ChartBar, Clock, CalendarBlank, Users, ArrowRight, DownloadSimple, Spinner, Sparkle } from '@phosphor-icons/react';
import { useRouter } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { getSlideActivityStats } from '@/services/study-library/slide-operations/slide-activity-stats';
import { downloadAllAssignmentSubmissions } from '@/services/study-library/slide-operations/download-assignment-submissions';
import { UserActivity } from '@/types/study-library/activity-stats-response-type';
import { useActivityStatsStore } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-stores/activity-stats-store';
import { useContentStore } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-stores/chapter-sidebar-store';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { AssignmentCheckSubmittedDialog } from './assignment-check-submitted-dialog';

export const ActivityStatsSidebar = ({
    open: controlledOpen,
    onOpenChange,
    hideTrigger = false,
}: {
    /** Controlled mode (e.g. opened from the ⋯ menu): pass open + onOpenChange and hideTrigger. */
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    hideTrigger?: boolean;
} = {}) => {
    const { t } = useTranslation('studyLibraryActivitySidebar');
    const [internalOpen, setInternalOpen] = useState(false);
    const isControlled = controlledOpen !== undefined;
    const open = isControlled ? controlledOpen : internalOpen;
    const setOpen = (o: boolean) => {
        if (isControlled) onOpenChange?.(o);
        else setInternalOpen(o);
    };
    const [isDownloading, setIsDownloading] = useState(false);
    const [aiCheckOpen, setAiCheckOpen] = useState(false);
    const [searchInput, setSearchInput] = useState('');
    // What the API is actually filtered by. Kept separate from searchInput so typing is debounced.
    const [appliedSearch, setAppliedSearch] = useState('');

    const handleDownload = async () => {
        if (!slideId) return;
        setIsDownloading(true);
        try {
            await downloadAllAssignmentSubmissions(slideId, packageSessionId);
        } catch (err) {
            console.error('Failed to download all submissions:', err);
        } finally {
            setIsDownloading(false);
        }
    };

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchInput(e.target.value);
    };
    const router = useRouter();
    const {
        slideId: routeSlideId,
        courseId,
        levelId,
        sessionId,
    } = router.state.location.search as {
        slideId?: string;
        courseId?: string;
        levelId?: string;
        sessionId?: string;
    };
    const { activeItem } = useContentStore();
    const { getPackageSessionId } = useInstituteDetailsStore();
    const slideId = routeSlideId || activeItem?.id || '';
    // The slide is shared across batches; scope the activity list to the batch being viewed.
    const packageSessionId =
        getPackageSessionId({
            courseId: courseId ?? '',
            levelId: levelId ?? '',
            sessionId: sessionId ?? '',
        }) ?? undefined;

    const { page, pageSize, handlePageChange } = usePaginationState({
        initialPage: 0,
        initialPageSize: 10,
    });

    // A search always restarts from the first page — the old page number belongs to the unfiltered list.
    const applySearch = (value: string) => {
        setAppliedSearch(value.trim());
        handlePageChange(0);
    };

    useEffect(() => {
        const timer = setTimeout(() => applySearch(searchInput), 300);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchInput]);

    const {
        data: activityStats,
        isLoading,
        error,
    } = useQuery({
        ...getSlideActivityStats({
            slideId,
            page,
            size: pageSize,
            packageSessionId,
            search: appliedSearch,
        }),
        enabled: open && !!slideId,
    });

    const formatTimeSpent = (timeInSeconds: number) => {
        const hours = Math.floor(timeInSeconds / 3600);
        const minutes = Math.floor((timeInSeconds % 3600) / 60);
        const seconds = timeInSeconds % 60;
        if (hours > 0) return `${hours}h ${minutes}m`;
        if (minutes > 0) return `${minutes}m ${seconds}s`;
        return `${seconds}s`;
    };

    const formatLastActive = (iso: string) => {
        const d = new Date(iso);
        const now = new Date();
        const diffMs = now.getTime() - d.getTime();
        const diffMin = Math.floor(diffMs / 60000);
        const diffHr = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);
        if (diffMin < 1) return t('time.justNow');
        if (diffMin < 60) return t('time.minutesAgo', { count: diffMin });
        if (diffHr < 24) return t('time.hoursAgo', { count: diffHr });
        if (diffDays < 7) return t('time.daysAgo', { count: diffDays });
        return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
    };

    const getInitials = (name: string) =>
        name
            .split(' ')
            .map((n) => n[0])
            .filter(Boolean)
            .slice(0, 2)
            .join('')
            .toUpperCase();

    const avatarColors = [
        'bg-rose-100 text-rose-700',
        'bg-amber-100 text-amber-700',
        'bg-emerald-100 text-emerald-700',
        'bg-sky-100 text-sky-700',
        'bg-violet-100 text-violet-700',
        'bg-fuchsia-100 text-fuchsia-700',
    ];
    const colorForName = (name: string) =>
        avatarColors[(name.charCodeAt(0) || 0) % avatarColors.length];

    type StudentRow = {
        id: string;
        user_id: string;
        full_name: string;
        time_spent_seconds: number;
        time_spent: string;
        last_active: string;
        last_active_raw: string;
        review_status: 'PENDING' | 'REVIEWED' | null;
        late_submission: boolean;
    };

    const students: StudentRow[] = useMemo(() => {
        if (!activityStats?.content) return [];
        return activityStats.content.map((item: UserActivity) => ({
            id: item.userId,
            user_id: item.userId,
            full_name: item.fullName,
            time_spent_seconds: item.totalTimeSpent,
            time_spent: formatTimeSpent(item.totalTimeSpent),
            last_active: formatLastActive(item.lastActive),
            last_active_raw: item.lastActive,
            review_status: item.reviewStatus ?? null,
            late_submission: !!item.lateSubmission,
        }));
    }, [activityStats]);

    // No client-side filtering: the API already returns only the matches, across every page.
    const totalParticipants = activityStats?.totalElements ?? 0;
    const avgTimeSeconds = students.length
        ? Math.round(
              students.reduce((acc: number, s: StudentRow) => acc + s.time_spent_seconds, 0) /
                  students.length
          )
        : 0;
    const totalPages = activityStats?.totalPages ?? 0;

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            {!hideTrigger && (
                <DialogTrigger asChild>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        layoutVariant="default"
                        title={t('activityStats')}
                    >
                        <ChartBar className="size-4 md:hidden" />
                        <span className="hidden md:inline">{t('activityStats')}</span>
                    </MyButton>
                </DialogTrigger>
            )}
            <DialogContent className="flex h-[680px] max-h-[92vh] w-[760px] max-w-[95vw] flex-col gap-0 overflow-hidden p-0 font-normal">
                {/* Hero header */}
                <DialogHeader className="flex shrink-0 flex-col gap-0 space-y-0">
                    <div className="flex items-center gap-3 border-b border-neutral-200 bg-gradient-to-r from-primary-50 to-white px-6 py-5">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-500 text-white shadow-sm">
                            <ChartBar size={20} weight="duotone" />
                        </div>
                        <div className="flex flex-col">
                            <h2 className="text-lg font-semibold text-neutral-900">
                                {t('activityStats')}
                            </h2>
                            <p className="text-xs text-neutral-500">
                                {t('trackEngagementSubtitle')}
                            </p>
                        </div>
                        {activeItem?.source_type === 'ASSIGNMENT' && (
                            <MyButton
                                type="button"
                                scale="small"
                                buttonType="primary"
                                className="ml-auto gap-1.5 font-medium"
                                onClick={() => setAiCheckOpen(true)}
                                disabled={!slideId}
                                title="Check every submitted copy with AI - you review the marks before learners see them"
                            >
                                <Sparkle size={14} weight="fill" />
                                Check submitted copies with AI
                            </MyButton>
                        )}
                        {activeItem?.source_type === 'ASSIGNMENT' && (
                            <button
                                type="button"
                                onClick={handleDownload}
                                disabled={isDownloading || !slideId}
                                className="ml-2 mr-6 flex items-center gap-1.5 rounded-md border border-primary-200 bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-600 transition-colors hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-50"
                                title={t('downloadAllSubmissions')}
                            >
                                {isDownloading ? (
                                    <Spinner size={14} className="animate-spin" />
                                ) : (
                                    <DownloadSimple size={14} />
                                )}
                                {isDownloading ? t('downloading') : t('downloadCsv')}
                            </button>
                        )}
                    </div>

                    {/* Stat strip */}
                    <div className="grid grid-cols-2 gap-px border-b border-neutral-200 bg-neutral-100 sm:grid-cols-3">
                        <div className="flex items-center gap-3 bg-white px-6 py-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-50 text-primary-600">
                                <Users size={16} weight="bold" />
                            </div>
                            <div>
                                <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                                    {t('participants')}
                                </p>
                                <p className="text-sm font-semibold text-neutral-900">
                                    {totalParticipants}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 bg-white px-6 py-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-50 text-emerald-600">
                                <Clock size={16} weight="bold" />
                            </div>
                            <div>
                                <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                                    {t('avgTime')}
                                </p>
                                <p className="text-sm font-semibold text-neutral-900">
                                    {formatTimeSpent(avgTimeSeconds)}
                                </p>
                            </div>
                        </div>
                        <div className="hidden items-center gap-3 bg-white px-6 py-3 sm:flex">
                            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-amber-50 text-amber-600">
                                <CalendarBlank size={16} weight="bold" />
                            </div>
                            <div>
                                <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                                    {t('onThisPage')}
                                </p>
                                <p className="text-sm font-semibold text-neutral-900">
                                    {students.length}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Search */}
                    <div className="border-b border-neutral-200 bg-white px-6 py-3">
                        <StudentSearchBox
                            searchInput={searchInput}
                            searchFilter={appliedSearch}
                            onSearchChange={handleSearchChange}
                            onSearchEnter={() => applySearch(searchInput)}
                            onClearSearch={() => {
                                setSearchInput('');
                                applySearch('');
                            }}
                            placeholder={t('searchPlaceholder')}
                        />
                    </div>
                </DialogHeader>

                {/* Body — student list */}
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-neutral-50">
                    <div className="flex-1 overflow-y-auto px-4 py-4">
                        {isLoading ? (
                            <div className="space-y-3">
                                {Array.from({ length: 6 }).map((_, idx) => (
                                    <div
                                        key={idx}
                                        className="h-16 animate-pulse rounded-lg border border-neutral-200 bg-white"
                                    />
                                ))}
                            </div>
                        ) : error ? (
                            <div className="flex h-32 items-center justify-center text-sm text-red-500">
                                {t('failedToLoad')}
                            </div>
                        ) : students.length === 0 ? (
                            <div className="flex h-48 flex-col items-center justify-center gap-2 text-neutral-500">
                                <Users size={32} className="text-neutral-300" />
                                <p className="text-sm font-medium">
                                    {searchInput ? t('noMatchesFound') : t('noActivityYet')}
                                </p>
                                <p className="text-xs">
                                    {searchInput
                                        ? t('tryDifferentSearch')
                                        : t('activityWillAppear')}
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {students.map((student: StudentRow) => (
                                    <button
                                        key={student.id}
                                        onClick={() =>
                                            useActivityStatsStore
                                                .getState()
                                                .openDialog(student.user_id, student.full_name)
                                        }
                                        className="group flex w-full items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3 text-left transition-all hover:border-primary-300 hover:shadow-sm"
                                    >
                                        <Avatar className="h-10 w-10">
                                            <AvatarFallback
                                                className={`text-sm font-semibold ${colorForName(
                                                    student.full_name
                                                )}`}
                                            >
                                                {getInitials(student.full_name)}
                                            </AvatarFallback>
                                        </Avatar>

                                        <div className="flex min-w-0 flex-1 flex-col">
                                            <p className="truncate text-sm font-semibold text-neutral-900">
                                                {student.full_name}
                                            </p>
                                            <div className="flex items-center gap-3 text-xs text-neutral-500">
                                                <span className="flex items-center gap-1">
                                                    <Clock size={12} />
                                                    {student.time_spent}
                                                </span>
                                                <span className="text-neutral-300">·</span>
                                                <span className="flex items-center gap-1">
                                                    <CalendarBlank size={12} />
                                                    {student.last_active}
                                                </span>
                                            </div>
                                        </div>

                                        {student.late_submission && (
                                            <span
                                                className="flex shrink-0 items-center rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700"
                                                title={t('lateSubmissionTooltip')}
                                            >
                                                {t('late')}
                                            </span>
                                        )}
                                        {student.review_status && (
                                            <span
                                                className={`flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                                                    student.review_status === 'REVIEWED'
                                                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                                        : 'border-amber-200 bg-amber-50 text-amber-700'
                                                }`}
                                            >
                                                {student.review_status === 'REVIEWED'
                                                    ? t('checked')
                                                    : t('pendingReview')}
                                            </span>
                                        )}

                                        <div className="flex shrink-0 items-center gap-1.5 rounded-md border border-transparent px-2.5 py-1.5 text-xs font-medium text-primary-600 transition-colors group-hover:border-primary-200 group-hover:bg-primary-50">
                                            {t('viewActivity')}
                                            <ArrowRight size={12} />
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {totalPages > 1 && (
                        <div className="border-t border-neutral-200 bg-white px-4 py-3">
                            <MyPagination
                                currentPage={page}
                                totalPages={totalPages}
                                onPageChange={handlePageChange}
                            />
                        </div>
                    )}

                    <ActivityLogDialog />
                </div>
            </DialogContent>
            {activeItem?.source_type === 'ASSIGNMENT' && slideId && (
                <AssignmentCheckSubmittedDialog
                    open={aiCheckOpen}
                    onOpenChange={setAiCheckOpen}
                    slideId={slideId}
                    packageSessionId={packageSessionId}
                />
            )}
        </Dialog>
    );
};
