import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MyButton } from '@/components/design-system/button';
import { Button } from '@/components/ui/button';
import {
    PaperPlaneTilt,
    Eye,
    EyeSlash,
    Copy,
    CircleNotch,
    TrashSimple,
    ClockCounterClockwise,
    PaperPlaneRight,
    BookOpen,
    UsersThree,
} from '@phosphor-icons/react';
import { convertCapitalToTitleCase } from '@/lib/utils';
import { getTerminology, getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { toast } from 'sonner';
import { useNavigate } from '@tanstack/react-router';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import {
    getMyCourses,
    createEditableCopy,
    submitForReview,
    publishCourse,
    getMyCourseHistory,
} from '../-services/approval-services';
import { formatDistanceToNow } from 'date-fns';
import { Input } from '@/components/ui/input';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { useDeleteCourse } from '@/services/study-library/course-operations/delete-course';
import { getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';
import { getDisplaySettings, getDisplaySettingsFromCache } from '@/services/display-settings';
import type { DisplaySettingsData } from '@/types/display-settings';
import { useFileUpload } from '@/hooks/use-file-upload';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { MyDialog } from '@/components/design-system/dialog';
import { MyPagination } from '@/components/design-system/pagination';
import { useCourseListStateStore } from '../-stores/course-list-state-store';

interface PackageEntity {
    id: string;
    packageName: string;
    updatedAt: string;
    thumbnailFileId: string | null;
    status: 'DRAFT' | 'IN_REVIEW' | 'ACTIVE';
    createdAt: string;
    isCoursePublishedToCatalaouge: boolean | null;
    coursePreviewImageMediaId: string | null;
    courseBannerMediaId: string | null;
    courseMediaId: string | null;
    whyLearn: string | null;
    whoShouldLearn: string | null;
    aboutTheCourse: string | null;
    tags: string | null;
    courseDepth: number | null;
    courseHtmlDescription: string | null;
    originalCourseId: string | null;
    createdByUserId: string | null;
    versionNumber: number | null;
}

interface SessionInfo {
    sessionId: string | null;
    sessionName: string | null;
    sessionStatus: string | null;
    sessionStartDate: string | null;
}

interface LevelInfo {
    levelId: string | null;
    levelName: string | null;
    durationInDays: number | null;
    levelStatus: string | null;
    levelThumbnailFileId: string | null;
    levelCreatedAt: string | null;
    levelUpdatedAt: string | null;
}

interface PackageSessionInfo {
    packageSessionIds: string | null;
    packageSessionCount: number;
    packageSessionStatuses: string | null;
}

interface DetailedCourseResponse {
    packageEntity: PackageEntity;
    relationshipType: 'CREATOR' | 'FACULTY_ASSIGNED';
    facultyAssignmentCount: number;
    assignedSubjects: string | null;
    courseId: string;
    courseName: string;
    courseStatus: 'DRAFT' | 'IN_REVIEW' | 'ACTIVE';
    createdAt: string;
    updatedAt: string;
    sessionInfo: SessionInfo;
    levelInfo: LevelInfo;
    packageSessionInfo: PackageSessionInfo;
    facultyAssigned: boolean;
    creator: boolean;
    /** Count of ACTIVE student enrollments across all sessions of this package. */
    enrolledStudentCount?: number | null;
}

interface PaginatedCoursesResponse {
    content: DetailedCourseResponse[];
    totalElements: number;
    totalPages: number;
    number: number;
    size: number;
    first: boolean;
    last: boolean;
}

// Display course interface - each packageSession entry shown separately
interface DisplayCourse {
    id: string; // Unique identifier for this entry (courseId + sessionId + levelId)
    courseId: string;
    packageId: string; // Package ID for deletion
    packageName: string;
    status: 'DRAFT' | 'IN_REVIEW' | 'ACTIVE';
    updatedAt: string;
    createdAt: string;
    originalCourseId: string | null;
    courseHtmlDescription: string | null;
    relationshipType: 'CREATOR' | 'FACULTY_ASSIGNED';
    facultyAssignmentCount: number;
    creator: boolean;
    facultyAssigned: boolean;
    thumbnailFileId: string | null;
    coursePreviewImageMediaId: string | null;
    courseBannerMediaId: string | null;
    sessionInfo: SessionInfo;
    levelInfo: LevelInfo;
    tags: string[];
    isCoursePublishedToCatalaouge: boolean | null;
    enrolledStudentCount: number;
}

const MAX_VISIBLE_TAGS = 5;

const isDefaultName = (name: string | null | undefined): boolean => {
    if (!name) return true;
    const n = name.toLowerCase();
    return n === 'default' || n === 'n/a' || n === 'na';
};

interface AuthoredCoursesTabProps {
    searchValue: string;
    setSearchValue: (value: string) => void;
}

export const AuthoredCoursesTab: React.FC<AuthoredCoursesTabProps> = ({
    searchValue,
    setSearchValue,
}) => {
    const { t } = useTranslation('authoredCourses');
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [filteredCourses, setFilteredCourses] = useState<DisplayCourse[]>([]);
    const [copyingCourseId, setCopyingCourseId] = useState<string | null>(null);
    const [deletingCourseId, setDeletingCourseId] = useState<string | null>(null);
    const [submittingCourseId, setSubmittingCourseId] = useState<string | null>(null);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState<string | null>(null);
    const [historyDialogCourseId, setHistoryDialogCourseId] = useState<string | null>(null);
    // Page index lives in the shared course-list store so it survives opening a
    // course and navigating back (this component unmounts in between).
    const currentPage = useCourseListStateStore((s) => s.authoredPage);
    const setCurrentPage = useCourseListStateStore((s) => s.setAuthoredPage);
    const [pageSize] = useState<number>(20);
    const [totalPages, setTotalPages] = useState<number>(0);
    const [totalElements, setTotalElements] = useState<number>(0);

    // Delete course mutation
    const deleteCourseMutation = useDeleteCourse();

    // Get current user data
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const tokenData = getTokenDecodedData(accessToken);
    const isAdmin =
        tokenData?.authorities &&
        Object.values(tokenData.authorities).some(
            (auth: { roles?: string[] }) =>
                Array.isArray(auth?.roles) && auth.roles.includes('ADMIN')
        );

    // Display settings — gates Copy to Edit / Delete buttons on the card.
    // When the field is missing from saved/cached settings (older payloads
    // predate this toggle), default to: visible for admin, hidden for
    // teacher / sub-org / custom roles.
    // Seeded from cache so the Publish / Submit-for-Review decision below is
    // right on first paint; null only on a cold cache, which disables the
    // draft action until the policy arrives.
    const [roleDisplay, setRoleDisplay] = useState<DisplaySettingsData | null>(
        () => getDisplaySettingsFromCache(getActiveRoleDisplaySettingsKey()) ?? null
    );
    useEffect(() => {
        const roleKey = getActiveRoleDisplaySettingsKey();
        // Force-refresh on mount so admin policy changes (Course Permission
        // toggles) take effect on the next page load without waiting for
        // the 24h localStorage TTL.
        getDisplaySettings(roleKey, true)
            .then(setRoleDisplay)
            .catch(() => {
                const cached = getDisplaySettingsFromCache(roleKey);
                setRoleDisplay(cached ?? null);
            });
    }, []);
    const cardSettings = roleDisplay?.authoredCoursesCard;
    const allowDirectEditPublished =
        roleDisplay?.coursePage?.directEditPublishedCourse === true;
    // When direct-edit is on, the Copy-to-Edit step on published courses is
    // bypassed — non-admin roles edit published courses in place. The
    // DRAFT → IN_REVIEW → ACTIVE approval path for new draft courses is left
    // intact so teachers still have a way to publish brand-new courses.
    const showCopyToEdit =
        !allowDirectEditPublished &&
        (cardSettings ? cardSettings.showCopyToEdit !== false : Boolean(isAdmin));
    const showDelete = cardSettings ? cardSettings.showDelete !== false : Boolean(isAdmin);
    const showEnrolledStudentCount =
        roleDisplay?.courseListCard?.showEnrolledStudentCount === true;
    // On by default (the long-standing flow): a draft's action button is
    // "Submit for Review". Only when the admin turns this off for the role
    // does it become "Publish" and go straight to ACTIVE.
    const requireApproval = roleDisplay?.coursePage?.requireCourseApproval !== false;
    const approvalPolicyKnown = roleDisplay !== null;

    // Fetch authored courses
    const {
        data: coursesResponse,
        isLoading,
        refetch,
        error,
    } = useQuery<PaginatedCoursesResponse>({
        queryKey: ['my-courses-authored', currentPage, pageSize],
        // Server sends Cache-Control: max-age=120 on this list, so a plain refetch
        // after a mutation (copy/delete/submit) is served from the browser HTTP cache
        // and misses the change. Bust the URL to force a roundtrip.
        queryFn: () => getMyCourses(currentPage, pageSize, true),
        staleTime: 30000, // Consider data fresh for 30 seconds
        refetchOnWindowFocus: false, // Don't refetch on window focus
    });

    // Extract courses and pagination info from response
    const courses = coursesResponse?.content || [];

    // Update pagination metadata when data changes
    useEffect(() => {
        if (coursesResponse) {
            setTotalPages(coursesResponse.totalPages);
            setTotalElements(coursesResponse.totalElements);
            // The stored page can outlive the courses it pointed at (e.g. the
            // last course on the page was deleted). Only snap back when it is
            // genuinely out of range.
            if (coursesResponse.totalPages > 0 && currentPage >= coursesResponse.totalPages) {
                setCurrentPage(coursesResponse.totalPages - 1);
            }
        }
    }, [coursesResponse, currentPage, setCurrentPage]);

    // Create editable copy mutation. We prepend a synthesized DRAFT entry to page 0's
    // cache as soon as the POST returns, so the new card shows up instantly without
    // waiting for the list refetch roundtrip. The refetch still runs in the background
    // and replaces the synthetic entry with the authoritative one.
    const createCopyMutation = useMutation<
        { sourceCourse: DisplayCourse; newCourseId: string | null },
        Error,
        DisplayCourse
    >({
        mutationFn: async (sourceCourse) => {
            const data = await createEditableCopy(sourceCourse.courseId);
            // Backend response is plain text: "Editable copy created with ID: <uuid>"
            const newCourseId = String(data ?? '').match(/ID:\s*(\S+)/)?.[1]?.trim() ?? null;
            return { sourceCourse, newCourseId };
        },
        onSuccess: ({ sourceCourse, newCourseId }) => {
            toast.success(t('copyCreated'));
            setCopyingCourseId(null);

            const targetPage = 0;
            const queryKey = ['my-courses-authored', targetPage, pageSize];
            const sourceResponse = courses.find((c) => c.courseId === sourceCourse.courseId);

            if (newCourseId && sourceResponse) {
                const now = new Date().toISOString();
                const synthetic: DetailedCourseResponse = {
                    ...sourceResponse,
                    courseId: newCourseId,
                    courseStatus: 'DRAFT',
                    createdAt: now,
                    updatedAt: now,
                    relationshipType: 'CREATOR',
                    creator: true,
                    facultyAssigned: false,
                    facultyAssignmentCount: 0,
                    enrolledStudentCount: 0,
                    packageEntity: {
                        ...sourceResponse.packageEntity,
                        id: newCourseId,
                        status: 'DRAFT',
                        originalCourseId: sourceCourse.courseId,
                        createdAt: now,
                        updatedAt: now,
                    },
                };
                queryClient.setQueryData<PaginatedCoursesResponse>(queryKey, (prev) => {
                    if (!prev) return prev;
                    const deduped = prev.content.filter((c) => c.courseId !== newCourseId);
                    return {
                        ...prev,
                        content: [synthetic, ...deduped],
                        totalElements: prev.totalElements + 1,
                    };
                });
            }

            // Page 0 is where the new copy sorts (created_at DESC). If we're already
            // there, refetch in the background to validate the synthetic entry;
            // otherwise switching pages changes the queryKey and React Query fetches.
            if (currentPage === targetPage) {
                refetch();
            } else {
                setCurrentPage(targetPage);
            }
            navigate({ to: '/study-library/courses' });
        },
        onError: (error: Error) => {
            toast.error(error.message || t('copyFailed'));
            setCopyingCourseId(null);
        },
    });

    // Submit for review / direct publish mutation (which one depends on the
    // role's requireCourseApproval toggle)
    const submitReviewMutation = useMutation({
        mutationFn: (courseId: string) =>
            requireApproval ? submitForReview(courseId) : publishCourse(courseId),
        onSuccess: () => {
            setSubmittingCourseId(null);
            toast.success(requireApproval ? t('submittedForReview') : t('published'));
            refetch();
        },
        onError: (error: Error) => {
            setSubmittingCourseId(null);
            toast.error(error.message || (requireApproval ? t('submitFailed') : t('publishFailed')));
        },
    });

    // Course History query (teacher)
    interface CourseHistoryLogItem {
        timestamp: number;
        actorUserId: string;
        action: string;
        message: string;
        comment?: string;
    }

    interface CourseHistoryResponse {
        courseId: string;
        courseName: string;
        status: string;
        createdByUserId: string;
        originalCourseId?: string | null;
        originalCourseName?: string | null;
        originalCourseStatus?: string | null;
        versionNumber?: number | null;
        auditLogs: CourseHistoryLogItem[];
    }

    const {
        data: courseHistory,
        isFetching: isHistoryFetching,
        error: historyError,
    } = useQuery<CourseHistoryResponse | undefined>({
        queryKey: ['teacher-course-history', historyDialogCourseId],
        queryFn: () => getMyCourseHistory(historyDialogCourseId as string),
        enabled: Boolean(historyDialogCourseId),
    });

    const sortByTimestampAsc = (a: CourseHistoryLogItem, b: CourseHistoryLogItem): number =>
        a.timestamp - b.timestamp;

    // Filter courses based on search - show each packageSession entry separately
    useEffect(() => {
        if (!courses) return;

        // Map each response to a display course (no grouping)
        const displayCourses: DisplayCourse[] = courses.map((response: DetailedCourseResponse) => {
            const course = response.packageEntity;
            // Create unique ID for each entry
            const uniqueId = `${response.courseId}_${response.sessionInfo.sessionId}_${response.levelInfo.levelId}`;

            // Backend currently sends `tags` as a comma-separated string,
            // but defend against an array shape in case the API changes
            // or the cache holds a previously-typed payload.
            const rawTags: unknown = (course as { tags?: unknown }).tags;
            const parsedTags: string[] = Array.isArray(rawTags)
                ? (rawTags as string[])
                : typeof rawTags === 'string'
                  ? rawTags
                        .split(',')
                        .map((t) => t.trim())
                        .filter(Boolean)
                  : [];

            return {
                id: uniqueId,
                courseId: response.courseId,
                packageId: course.id,
                packageName: course.packageName,
                status: course.status,
                updatedAt: course.updatedAt,
                createdAt: course.createdAt,
                originalCourseId: course.originalCourseId,
                courseHtmlDescription: course.courseHtmlDescription,
                relationshipType: response.relationshipType,
                facultyAssignmentCount: response.facultyAssignmentCount,
                creator: response.creator,
                facultyAssigned: response.facultyAssigned,
                thumbnailFileId: course.thumbnailFileId,
                coursePreviewImageMediaId: course.coursePreviewImageMediaId,
                courseBannerMediaId: course.courseBannerMediaId,
                sessionInfo: response.sessionInfo,
                levelInfo: response.levelInfo,
                tags: parsedTags,
                isCoursePublishedToCatalaouge: course.isCoursePublishedToCatalaouge,
                enrolledStudentCount: response.enrolledStudentCount ?? 0,
            };
        });

        // Filter courses
        const filtered = displayCourses.filter((course) => {
            // Show only ACTIVE and DRAFT courses (not IN_REVIEW ones - they go to separate tab)
            const isValidStatus = ['ACTIVE', 'DRAFT'].includes(course.status);

            // Search filter
            const matchesSearch =
                !searchValue ||
                course.packageName.toLowerCase().includes(searchValue.toLowerCase());

            return isValidStatus && matchesSearch;
        });

        setFilteredCourses(filtered);
    }, [courses, searchValue]);

    const handleViewCourse = (course: DisplayCourse) => {
        navigate({
            to: '/study-library/courses/course-details',
            search: {
                courseId: course.courseId,
                sessionId: course.sessionInfo?.sessionId ?? undefined,
                levelId: course.levelInfo?.levelId ?? undefined,
            },
        });
    };

    const handleCopyToEdit = (course: DisplayCourse) => {
        setCopyingCourseId(course.courseId);
        createCopyMutation.mutate(course);
    };

    const handleSubmitForReview = (courseId: string) => {
        setSubmittingCourseId(courseId);
        submitReviewMutation.mutate(courseId);
    };

    const handleDeleteCourse = (entryId: string) => {
        // Find the course to get the packageId
        const course = filteredCourses.find((c) => c.id === entryId);
        if (!course) {
            toast.error(t('courseNotFound'));
            return;
        }

        console.log('Deleting course:', { courseId: course.courseId, packageId: course.packageId });

        setDeletingCourseId(entryId);
        setDeleteDialogOpen(null); // Close the dialog
        deleteCourseMutation.mutate(course.packageId, {
            onSuccess: () => {
                toast.success(t('deletedSuccess'));
                refetch();
                setDeletingCourseId(null);
            },
            onError: (error: unknown) => {
                const errMsg =
                    error && typeof error === 'object' && 'message' in error
                        ? (error as { message?: string }).message
                        : undefined;
                toast.error(errMsg || t('deleteFailed'));
                setDeletingCourseId(null);
            },
        });
    };

    const canCreateCopy = (course: DisplayCourse) => {
        if (!filteredCourses) return false;
        // Prevent multiple draft copies: Check if there's already a draft copy of this published course
        // by looking for any course where originalCourseId matches this course's courseId and status is DRAFT
        const hasDraftCopy = filteredCourses.some(
            (c) => c.originalCourseId === course.courseId && c.status === 'DRAFT'
        );
        return !hasDraftCopy;
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'ACTIVE':
                return <Badge className="bg-green-100 text-green-800">{t('status.published')}</Badge>;
            case 'DRAFT':
                return <Badge>{t('status.draft')}</Badge>;
            case 'IN_REVIEW':
                return <Badge>{t('status.inReview')}</Badge>;
            default:
                return <Badge>{status}</Badge>;
        }
    };

    const CourseThumbnail: React.FC<{ course: DisplayCourse }> = ({ course }) => {
        const { getPublicUrl } = useFileUpload();
        const [imageUrl, setImageUrl] = useState<string>('');
        const [isLoading, setIsLoading] = useState(false);

        const mediaId = course.coursePreviewImageMediaId;

        useEffect(() => {
            if (mediaId) {
                setIsLoading(true);
                getPublicUrl(mediaId)
                    .then((url: string | undefined) => {
                        setImageUrl(url || '');
                    })
                    .catch((error: unknown) => {
                        console.error('Failed to get thumbnail URL:', error);
                        setImageUrl('');
                    })
                    .finally(() => {
                        setIsLoading(false);
                    });
            }
        }, [mediaId, getPublicUrl]);

        const displayName = convertCapitalToTitleCase(course.packageName);

        return (
            <div className="relative flex aspect-[2/1] w-full flex-shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br from-primary-50 via-primary-100/50 to-white">
                {isLoading ? (
                    <div className="size-8 animate-spin rounded-full border-2 border-gray-300 border-t-transparent"></div>
                ) : mediaId && imageUrl ? (
                    <img
                        src={imageUrl}
                        alt={course.packageName}
                        className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                        onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                        }}
                    />
                ) : (
                    <div className="flex flex-col items-center justify-center gap-1.5 p-3 text-center">
                        <BookOpen size={32} weight="duotone" className="text-primary-400" />
                        <span className="line-clamp-2 text-xs font-medium text-primary-600/80">
                            {displayName}
                        </span>
                    </div>
                )}
            </div>
        );
    };

    if (isLoading) {
        return <DashboardLoader />;
    }

    if (error) {
        return (
            <div className="flex h-40 flex-col items-center justify-center text-red-500">
                <p>{t('errorLoadingCourses')}</p>
                <MyButton onClick={() => refetch()} className="mt-2">
                    {t('retry')}
                </MyButton>
            </div>
        );
    }

    // Pagination handler
    const handlePageChange = (newPage: number) => {
        setCurrentPage(newPage);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    return (
        <div className="space-y-4 sm:space-y-6">
            {/* Search Bar - Full width on mobile */}
            <div className="flex items-center gap-4">
                <Input
                    placeholder={t('searchCourses')}
                    value={searchValue}
                    onChange={(e) => setSearchValue(e.target.value)}
                    className="w-full sm:max-w-md"
                />
            </div>

            {/* Courses List */}
            {filteredCourses.length === 0 ? (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <h3 className="mb-2 text-lg font-semibold">{t('noCoursesFoundTitle')}</h3>
                        <p className="text-gray-600">
                            {searchValue
                                ? t('noCoursesMatchSearch', { search: searchValue })
                                : t('noCoursesCreatedYet')}
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
                    {filteredCourses.map((course) => {
                        // Defensive: backend returns `tags` as a comma-separated
                        // string, and a stale cache or older bundle may still
                        // surface it that way. Normalise to an array so
                        // `.slice().map()` never blows up.
                        const rawTags: unknown = course.tags;
                        const tags: string[] = Array.isArray(rawTags)
                            ? (rawTags as string[])
                            : typeof rawTags === 'string'
                              ? rawTags
                                    .split(',')
                                    .map((t) => t.trim())
                                    .filter(Boolean)
                              : [];
                        const levelName = !isDefaultName(course.levelInfo.levelName)
                            ? course.levelInfo.levelName
                            : null;
                        const sessionName = !isDefaultName(course.sessionInfo.sessionName)
                            ? course.sessionInfo.sessionName
                            : null;
                        const description = (course.courseHtmlDescription || '')
                            .replace(/<[^>]*>/g, '')
                            .slice(0, 120);

                        return (
                            <div
                                key={course.id}
                                className="animate-fade-in group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white p-0 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
                                onClick={() => handleViewCourse(course)}
                            >
                                {/* Course Preview Image */}
                                <CourseThumbnail course={course} />

                                <div className="flex flex-1 flex-col gap-1 p-3">
                                    {/* Course Name */}
                                    <div className="line-clamp-2 min-w-0 text-sm font-bold text-neutral-800">
                                        {convertCapitalToTitleCase(course.packageName)}
                                    </div>

                                    {/* Level & Session badges */}
                                    {(levelName || sessionName) && (
                                        <div className="mt-1 flex flex-wrap gap-1">
                                            {levelName && (
                                                <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                                                    {convertCapitalToTitleCase(levelName)}
                                                </span>
                                            )}
                                            {sessionName && (
                                                <span className="rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
                                                    {sessionName}
                                                </span>
                                            )}
                                        </div>
                                    )}

                                    {/* Description */}
                                    <div
                                        className={
                                            description.length > 0
                                                ? 'mt-1 line-clamp-2 text-xs text-neutral-600 sm:mt-2 sm:text-sm'
                                                : 'text-xs text-neutral-600 sm:text-sm'
                                        }
                                    >
                                        {description}
                                    </div>

                                    {/* Tags */}
                                    {tags.length > 0 && (
                                        <div className="mt-2 flex flex-wrap gap-1.5">
                                            {tags.slice(0, MAX_VISIBLE_TAGS).map((tag) => (
                                                <span
                                                    key={tag}
                                                    className="flex-shrink-0 rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
                                                >
                                                    {tag}
                                                </span>
                                            ))}
                                            {tags.length > MAX_VISIBLE_TAGS && (
                                                <span
                                                    className="flex-shrink-0 rounded bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700"
                                                    title={tags.slice(MAX_VISIBLE_TAGS).join(', ')}
                                                >
                                                    {t('moreCount', { count: tags.length - MAX_VISIBLE_TAGS })}
                                                </span>
                                            )}
                                        </div>
                                    )}

                                    {/* Status and Copy Badges */}
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {getStatusBadge(course.status)}
                                        {course.originalCourseId && (
                                            <Badge className="px-2 text-xs">{t('copyBadge')}</Badge>
                                        )}
                                    </div>

                                    {/* In Catalog / Private indicator */}
                                    <span className="mt-2 flex items-center gap-1 rounded py-1 text-xs font-medium text-gray-500">
                                        {course.isCoursePublishedToCatalaouge ? (
                                            <>
                                                <Eye className="size-4" /> {t('inCatalog')}
                                            </>
                                        ) : (
                                            <>
                                                <EyeSlash className="size-4" /> {t('private')}
                                            </>
                                        )}
                                    </span>

                                    {/* Enrolled student count */}
                                    {showEnrolledStudentCount && (
                                        <span className="flex items-center gap-1 rounded py-1 text-xs font-medium text-gray-500">
                                            <UsersThree className="size-4" />
                                            {t('enrolledCount', {
                                                count: course.enrolledStudentCount,
                                                term:
                                                    course.enrolledStudentCount === 1
                                                        ? getTerminology(
                                                              RoleTerms.Learner,
                                                              SystemTerms.Learner
                                                          )
                                                        : getTerminologyPlural(
                                                              RoleTerms.Learner,
                                                              SystemTerms.Learner
                                                          ),
                                            })}
                                        </span>
                                    )}

                                    {/* Updated Date */}
                                    <span className="text-xs text-gray-500">
                                        {t('updatedAgo', { time: formatDistanceToNow(new Date(course.updatedAt)) })}
                                    </span>

                                    {/* Action Buttons */}
                                    <div
                                        className="mt-auto flex flex-wrap items-center gap-2 pt-3"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        {/* View Course Button */}
                                        <MyButton
                                            className="flex-1 text-sm"
                                            buttonType="primary"
                                            onClick={() => handleViewCourse(course)}
                                        >
                                            <Eye size={16} />
                                            {t('viewCourse')}
                                        </MyButton>

                                        {/* Additional Actions for Draft courses */}
                                        {course.status === 'DRAFT' && !isAdmin && (
                                            <>
                                                <Button
                                                    variant="default"
                                                    size="sm"
                                                    className="bg-green-600 text-white hover:bg-green-700"
                                                    onClick={() =>
                                                        handleSubmitForReview(course.courseId)
                                                    }
                                                    disabled={
                                                        submittingCourseId === course.courseId ||
                                                        !approvalPolicyKnown
                                                    }
                                                >
                                                    {submittingCourseId === course.courseId ? (
                                                        <CircleNotch
                                                            size={16}
                                                            className="animate-spin"
                                                        />
                                                    ) : (
                                                        <PaperPlaneRight
                                                            size={16}
                                                            weight="fill"
                                                        />
                                                    )}
                                                    {requireApproval
                                                        ? t('submitForReview')
                                                        : t('publish')}
                                                </Button>

                                                <Button
                                                    variant="outline"
                                                    size="icon"
                                                    className="size-8 text-blue-600 hover:bg-blue-50 hover:text-blue-700"
                                                    onClick={() =>
                                                        setHistoryDialogCourseId(course.courseId)
                                                    }
                                                    title={t('viewHistory')}
                                                >
                                                    <ClockCounterClockwise
                                                        size={16}
                                                        weight="fill"
                                                    />
                                                </Button>
                                            </>
                                        )}

                                        {/* Copy Button for Published courses */}
                                        {course.status === 'ACTIVE' &&
                                            !isAdmin &&
                                            showCopyToEdit &&
                                            canCreateCopy(course) && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="text-blue-600 hover:bg-blue-50 hover:text-blue-700"
                                                    onClick={() => handleCopyToEdit(course)}
                                                    disabled={
                                                        copyingCourseId === course.courseId
                                                    }
                                                >
                                                    {copyingCourseId === course.courseId ? (
                                                        <CircleNotch
                                                            size={16}
                                                            className="animate-spin"
                                                        />
                                                    ) : (
                                                        <Copy size={16} />
                                                    )}
                                                    {t('copyToEdit')}
                                                </Button>
                                            )}

                                        {/* Delete Button */}
                                        {showDelete && (
                                        <AlertDialog
                                            open={deleteDialogOpen === course.id}
                                            onOpenChange={(open) => {
                                                if (open) {
                                                    setDeleteDialogOpen(course.id);
                                                } else {
                                                    setDeleteDialogOpen(null);
                                                }
                                            }}
                                        >
                                            <AlertDialogTrigger className="flex size-9 items-center justify-center rounded-md border border-red-200 bg-red-50 text-red-500 transition-colors hover:border-red-300 hover:bg-red-100 active:scale-95">
                                                <TrashSimple size={18} />
                                            </AlertDialogTrigger>
                                            <AlertDialogContent className="w-[calc(100%-2rem)] max-w-md">
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>
                                                        {t('deleteConfirmTitle')}
                                                    </AlertDialogTitle>
                                                    <AlertDialogDescription>
                                                        {t('deleteConfirmBody')}
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
                                                    <AlertDialogCancel
                                                        disabled={deletingCourseId === course.id}
                                                        className="w-full sm:w-auto"
                                                    >
                                                        {t('cancel')}
                                                    </AlertDialogCancel>
                                                    <AlertDialogAction
                                                        onClick={() =>
                                                            handleDeleteCourse(course.id)
                                                        }
                                                        disabled={deletingCourseId === course.id}
                                                        className="w-full bg-primary-500 text-white sm:w-auto"
                                                    >
                                                        {deletingCourseId === course.id ? (
                                                            <CircleNotch
                                                                size={18}
                                                                className="animate-spin"
                                                            />
                                                        ) : (
                                                            t('delete')
                                                        )}
                                                    </AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
                <MyPagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    onPageChange={handlePageChange}
                />
            )}

            {/* Course History Dialog */}
            <MyDialog
                heading={
                    courseHistory?.courseName
                        ? t('courseHistoryWithName', { name: courseHistory.courseName })
                        : t('courseHistory')
                }
                open={Boolean(historyDialogCourseId)}
                onOpenChange={(open) => {
                    if (!open) setHistoryDialogCourseId(null);
                }}
                dialogWidth="max-w-3xl"
            >
                {isHistoryFetching ? (
                    <div className="flex items-center justify-center py-6 text-gray-600">
                        <CircleNotch size={18} className="mr-2 animate-spin" /> {t('loadingHistory')}
                    </div>
                ) : historyError ? (
                    <div className="rounded-md bg-red-50 p-4 text-red-700">
                        {t('loadHistoryFailed')}
                    </div>
                ) : courseHistory ? (
                    <div className="space-y-4">
                        <div className="grid gap-2 sm:grid-cols-2">
                            <div className="text-sm text-gray-600">
                                <span className="font-medium text-gray-800">{t('courseIdLabel')}</span>{' '}
                                {courseHistory.courseId}
                            </div>
                            <div className="text-sm text-gray-600">
                                <span className="font-medium text-gray-800">{t('statusLabel')}</span>{' '}
                                {courseHistory.status}
                            </div>
                            {courseHistory.versionNumber != null && (
                                <div className="text-sm text-gray-600">
                                    <span className="font-medium text-gray-800">{t('versionLabel')}</span>{' '}
                                    {courseHistory.versionNumber}
                                </div>
                            )}
                            {courseHistory.originalCourseName && (
                                <div className="text-sm text-gray-600">
                                    <span className="font-medium text-gray-800">{t('originalLabel')}</span>{' '}
                                    {courseHistory.originalCourseName}{' '}
                                    {courseHistory.originalCourseStatus && (
                                        <span>({courseHistory.originalCourseStatus})</span>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="pt-2">
                            <h4 className="mb-2 text-sm font-semibold text-gray-900">{t('auditLogs')}</h4>
                            {courseHistory.auditLogs && courseHistory.auditLogs.length > 0 ? (
                                <ul className="space-y-3">
                                    {courseHistory.auditLogs
                                        .slice()
                                        .sort(sortByTimestampAsc)
                                        .map((log: CourseHistoryLogItem, idx: number) => (
                                            <li
                                                key={`${log.timestamp}-${idx}`}
                                                className="rounded-lg border border-gray-100 bg-gray-50 p-3"
                                            >
                                                <div className="flex items-center justify-between">
                                                    <div className="text-xs font-medium uppercase tracking-wide text-gray-700">
                                                        {log.action}
                                                    </div>
                                                    <div className="text-xs text-gray-500">
                                                        {new Date(log.timestamp).toLocaleString()}
                                                    </div>
                                                </div>
                                                <div className="mt-1 text-sm text-gray-800">
                                                    {log.message}
                                                </div>
                                                <div className="mt-1 text-xs text-gray-600">
                                                    {t('byActor', { actor: log.actorUserId })}
                                                </div>
                                                {log.comment && (
                                                    <div className="mt-2 rounded bg-white p-2 text-xs text-gray-700">
                                                        {t('commentLabel', { comment: log.comment })}
                                                    </div>
                                                )}
                                            </li>
                                        ))}
                                </ul>
                            ) : (
                                <div className="text-sm text-gray-600">{t('noHistoryAvailable')}</div>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="text-sm text-gray-600">{t('noHistoryAvailable')}</div>
                )}
            </MyDialog>
        </div>
    );
};
