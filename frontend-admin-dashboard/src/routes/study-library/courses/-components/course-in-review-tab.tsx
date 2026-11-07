import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MyButton } from '@/components/design-system/button';
import { Eye, ArrowLeft, Clock, User } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useNavigate } from '@tanstack/react-router';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { getMyCourses, withdrawFromReview } from '../-services/approval-services';
import { formatDistanceToNow } from 'date-fns';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';

interface CoursePackageEntity {
    id: string;
    packageName: string;
    updatedAt: string;
    thumbnailFileId: string | null;
    status: string;
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
    createdByUserId: string;
    versionNumber: number | null;
}

interface SessionInfo {
    sessionId: string;
    sessionName: string;
    sessionStatus: string;
    sessionStartDate: string;
}

interface CourseInReviewResponse {
    packageEntity: CoursePackageEntity;
    relationshipType: string;
    facultyAssignmentCount: number;
    assignedSubjects: unknown;
    courseId: string;
    courseName: string;
    courseStatus: string;
    createdAt: string;
    updatedAt: string;
    sessionInfo: SessionInfo;
}

export const CourseInReviewTab: React.FC = () => {
    const { t } = useTranslation('studyLibraryCourseInReviewTab');
    const navigate = useNavigate();
    const [reviewCourses, setReviewCourses] = useState<CourseInReviewResponse[]>([]);
    const [roles, setRoles] = useState<string[] | undefined>([]);
    const { instituteDetails } = useInstituteDetailsStore();
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const tokenData = getTokenDecodedData(accessToken);

    // Fetch courses
    const {
        data: coursesResponse,
        isLoading,
        refetch,
        error,
    } = useQuery<{
        content: CourseInReviewResponse[];
    }>({
        queryKey: ['my-courses-in-review'],
        queryFn: async () => getMyCourses(0, 1000), // Fetch all for filtering
        staleTime: 30000, // Consider data fresh for 30 seconds
        refetchOnWindowFocus: false, // Don't refetch on window focus
    });

    // Extract courses from V2 paginated response
    const courses: CourseInReviewResponse[] = coursesResponse?.content || [];

    // Withdraw from review mutation
    const withdrawMutation = useMutation({
        mutationFn: withdrawFromReview,
        onSuccess: () => {
            toast.success(t('withdrawSuccess'));
            refetch();
        },
        onError: (error: Error) => {
            toast.error(error.message || t('withdrawFailed'));
        },
    });

    // Extract user roles
    useEffect(() => {
        if (tokenData && tokenData.authorities && instituteDetails?.id) {
            setRoles(tokenData.authorities[instituteDetails.id]?.roles ?? []);
        } else {
            setRoles([]);
        }
    }, [instituteDetails?.id, tokenData]);

    // Filter only IN_REVIEW courses and exclude 'invited' sessions for non-admin users
    useEffect(() => {
        if (!courses) return;

        // First filter for IN_REVIEW status
        let filtered = courses.filter((course: CourseInReviewResponse) => course.courseStatus === 'IN_REVIEW');

        // Check if user is admin
        const safeRoles = Array.isArray(roles) ? roles : [];
        const isAdmin = safeRoles.includes('ADMIN');

        // If user is not admin, filter out sessions with name 'invited'
        if (!isAdmin) {
            filtered = filtered.filter(
                (course: CourseInReviewResponse) => course.sessionInfo?.sessionName?.toLowerCase() !== 'invited'
            );
        }

        setReviewCourses(filtered);
    }, [courses, roles]);

    const handleViewCourse = (course: CourseInReviewResponse) => {
        navigate({
            to: '/study-library/courses/course-details',
            search: { courseId: course.courseId },
        });
    };

    const handleWithdrawFromReview = (courseId: string) => {
        withdrawMutation.mutate(courseId);
    };

    if (isLoading) {
        return <DashboardLoader />;
    }

    if (error) {
        return (
            <div className="flex h-40 flex-col items-center justify-center text-red-500">
                <p>{t('errorLoadingCourses')}</p>
                <MyButton onClick={() => refetch()} buttonType="secondary" className="mt-2">
                    {t('retry')}
                </MyButton>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h3 className="mb-2 text-lg font-semibold">{t('coursesInReview')}</h3>
                <p className="text-gray-600">
                    {t('reviewedByAdminsNote')}
                </p>
            </div>

            {/* Courses List */}
            {reviewCourses.length === 0 ? (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <Clock size={48} className="mb-4 text-gray-400" />
                        <h3 className="mb-2 text-lg font-semibold">{t('emptyState.title')}</h3>
                        <p className="text-gray-600">
                            {t('emptyState.description')}
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {reviewCourses.map((course) => (
                        <Card
                            key={course.courseId}
                            className="border-orange-200 transition-shadow hover:shadow-md"
                        >
                            <CardHeader className="pb-3">
                                <div className="flex items-start justify-between">
                                    <div className="min-w-0 flex-1">
                                        <CardTitle className="line-clamp-2 text-lg">
                                            {course.courseName}
                                        </CardTitle>
                                        <CardDescription className="mt-1">
                                            <div className="flex items-center gap-2 text-sm">
                                                <Clock size={14} />
                                                {t('submitted', {
                                                    time: formatDistanceToNow(
                                                        new Date(course.updatedAt),
                                                        { addSuffix: true }
                                                    ),
                                                })}
                                            </div>
                                        </CardDescription>
                                    </div>
                                    <div className="ml-2 flex flex-col gap-1">
                                        <Badge
                                            variant="default"
                                            className="bg-orange-100 text-orange-800"
                                        >
                                            {t('inReview')}
                                        </Badge>
                                        {course.packageEntity.originalCourseId && (
                                            <Badge variant="outline" className="text-xs">
                                                {t('update')}
                                            </Badge>
                                        )}
                                    </div>
                                </div>
                            </CardHeader>

                            <CardContent className="pt-0">
                                <div className="flex flex-col gap-2">
                                    {/* View Button */}
                                    <MyButton
                                        onClick={() => handleViewCourse(course)}
                                        buttonType="secondary"
                                        className="w-full justify-center"
                                    >
                                        <Eye size={16} className="mr-1" />
                                        {t('viewCourse')}
                                    </MyButton>

                                    {/* Withdraw from Review Button */}
                                    <MyButton
                                        onClick={() => handleWithdrawFromReview(course.courseId)}
                                        buttonType="secondary"
                                        className="w-full justify-center"
                                        disabled={withdrawMutation.isPending}
                                    >
                                        <ArrowLeft size={16} className="mr-1" />
                                        {withdrawMutation.isPending
                                            ? t('withdrawing')
                                            : t('withdrawFromReview')}
                                    </MyButton>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* Info Section */}
            <Card className="border-blue-200 bg-blue-50">
                <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                        <Clock size={20} className="mt-0.5 text-blue-600" />
                        <div>
                            <h4 className="mb-1 font-semibold text-blue-900">{t('reviewProcess.title')}</h4>
                            <p className="text-sm text-blue-700">
                                {t('reviewProcess.description')}
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};
