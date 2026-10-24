import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MyButton } from '@/components/design-system/button';
import { Clock, Eye, CheckCircle, XCircle, User } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useNavigate } from '@tanstack/react-router';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import {
    getAllPendingApprovalCourses,
    approveCourse,
    rejectCourse,
} from '../-services/approval-services';
import { formatDistanceToNow } from 'date-fns';

interface CourseForApproval {
    id: string;
    packageName: string;
    updatedAt: string;
    thumbnailFileId: string;
    status: string;
    createdAt: string;
    isCoursePublishedToCatalaouge: boolean;
    coursePreviewImageMediaId: string;
    courseBannerMediaId: string;
    courseMediaId: string;
    whyLearn: string;
    whoShouldLearn: string;
    aboutTheCourse: string;
    tags: string | null;
    courseDepth: number;
    courseHtmlDescription: string;
    originalCourseId: string | null;
    createdByUserId: string;
    versionNumber: number;
}

export const AdminApprovalDashboard: React.FC = () => {
    const { t } = useTranslation('studyLibraryAdminApprovalDashboard');
    const navigate = useNavigate();
    const [selectedCourse, setSelectedCourse] = useState<CourseForApproval | null>(null);
    const [rejectReason, setRejectReason] = useState('');
    const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);

    // Fetch pending approval courses
    const {
        data: pendingCourses,
        isLoading,
        refetch,
        error,
    } = useQuery<CourseForApproval[]>({
        queryKey: ['pending-approval-courses'],
        queryFn: getAllPendingApprovalCourses,
        refetchInterval: 30000, // Refetch every 30 seconds
    });

    // Approve course mutation
    const approveMutation = useMutation({
        mutationFn: ({
            courseId,
            originalCourseId,
        }: {
            courseId: string;
            originalCourseId?: string;
        }) => approveCourse(courseId, originalCourseId),
        onSuccess: () => {
            toast.success(t('approveSuccess'));
            refetch();
        },
        onError: (error: Error) => {
            toast.error(error.message || t('approveError'));
        },
    });

    // Reject course mutation
    const rejectMutation = useMutation({
        mutationFn: ({ courseId, reason }: { courseId: string; reason: string }) =>
            rejectCourse(courseId, reason),
        onSuccess: () => {
            toast.success(t('rejectSuccess'));
            setIsRejectDialogOpen(false);
            setRejectReason('');
            setSelectedCourse(null);
            refetch();
        },
        onError: (error: Error) => {
            toast.error(error.message || t('rejectError'));
        },
    });

    const handleViewCourse = (course: CourseForApproval) => {
        navigate({
            to: '/study-library/courses/course-details',
            search: { courseId: course.id },
        });
    };

    const handleApproveCourse = (course: CourseForApproval) => {
        approveMutation.mutate({
            courseId: course.id,
            originalCourseId: course.originalCourseId || undefined,
        });
    };

    const handleRejectCourse = (course: CourseForApproval) => {
        setSelectedCourse(course);
        setIsRejectDialogOpen(true);
    };

    const submitRejection = () => {
        if (selectedCourse && rejectReason.trim()) {
            rejectMutation.mutate({
                courseId: selectedCourse.id,
                reason: rejectReason.trim(),
            });
        }
    };

    if (isLoading) {
        return <DashboardLoader />;
    }

    if (error) {
        return (
            <div className="flex h-40 flex-col items-center justify-center text-red-500">
                <p>{t('loadError')}</p>
                <MyButton onClick={() => refetch()} buttonType="secondary" className="mt-2">
                    {t('retry')}
                </MyButton>
            </div>
        );
    }

    const coursesArray = pendingCourses || [];

    return (
        <div className="space-y-6">
            {/* Summary Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-semibold">{t('dashboardTitle')}</h2>
                    <p className="text-gray-600">{t('dashboardSubtitle')}</p>
                </div>
                <Badge variant="secondary" className="px-3 py-1 text-lg">
                    {t('pendingCount', { count: coursesArray.length })}
                </Badge>
            </div>

            {/* Pending Courses List */}
            {coursesArray.length === 0 ? (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <CheckCircle size={48} className="mb-4 text-green-500" />
                        <h3 className="mb-2 text-lg font-semibold">{t('allCaughtUpTitle')}</h3>
                        <p className="text-gray-600">{t('noPendingCourses')}</p>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-4">
                    {coursesArray.map((course) => (
                        <Card key={course.id} className="transition-shadow hover:shadow-md">
                            <CardHeader className="pb-3">
                                <div className="flex items-start justify-between">
                                    <div>
                                        <CardTitle className="text-lg">
                                            {course.packageName}
                                        </CardTitle>
                                        <CardDescription className="mt-1">
                                            <div className="flex items-center gap-4">
                                                <span className="flex items-center gap-1">
                                                    <Clock size={14} />
                                                    {t('updatedPrefix')}{' '}
                                                    {formatDistanceToNow(
                                                        new Date(course.updatedAt),
                                                        {
                                                            addSuffix: true,
                                                        }
                                                    )}
                                                </span>
                                            </div>
                                        </CardDescription>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Badge
                                            variant={
                                                course.status === 'IN_REVIEW'
                                                    ? 'default'
                                                    : 'secondary'
                                            }
                                        >
                                            {course.status === 'IN_REVIEW'
                                                ? t('statusInReview')
                                                : course.status}
                                        </Badge>
                                        {course.originalCourseId && (
                                            <Badge variant="outline">{t('updateBadge')}</Badge>
                                        )}
                                        <Badge variant="outline" className="text-xs">
                                            v{course.versionNumber}
                                        </Badge>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent>
                                {course.courseHtmlDescription && (
                                    <div className="mb-4">
                                        <p
                                            className="line-clamp-2 text-sm text-gray-600"
                                            dangerouslySetInnerHTML={{
                                                __html: course.courseHtmlDescription,
                                            }}
                                        />
                                    </div>
                                )}

                                {/* Course Details */}
                                <div className="mb-4 rounded-lg bg-gray-50 p-3 text-sm">
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <span className="font-medium text-gray-600">
                                                {t('depthLabel')}
                                            </span>
                                            <span className="ml-1">{course.courseDepth}</span>
                                        </div>
                                        <div>
                                            <span className="font-medium text-gray-600">
                                                {t('createdLabel')}
                                            </span>
                                            <span className="ml-1">
                                                {formatDistanceToNow(new Date(course.createdAt), {
                                                    addSuffix: true,
                                                })}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex gap-2">
                                    <MyButton
                                        onClick={() => handleViewCourse(course)}
                                        buttonType="secondary"
                                    >
                                        <Eye size={16} className="mr-1" />
                                        {t('review')}
                                    </MyButton>
                                    <MyButton
                                        onClick={() => handleApproveCourse(course)}
                                        buttonType="primary"
                                        disabled={approveMutation.isPending}
                                    >
                                        <CheckCircle size={16} className="mr-1" />
                                        {approveMutation.isPending
                                            ? t('approvingEllipsis')
                                            : t('approve')}
                                    </MyButton>
                                    <MyButton
                                        onClick={() => handleRejectCourse(course)}
                                        buttonType="secondary"
                                        className="border-red-600 text-red-600 hover:bg-red-50"
                                        disabled={rejectMutation.isPending}
                                    >
                                        <XCircle size={16} className="mr-1" />
                                        {t('reject')}
                                    </MyButton>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* Reject Dialog */}
            {isRejectDialogOpen && selectedCourse && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
                    <Card className="w-full max-w-md">
                        <CardHeader>
                            <CardTitle>{t('rejectDialogTitle')}</CardTitle>
                            <CardDescription>
                                {t('rejectDialogDescription', {
                                    courseName: selectedCourse.packageName,
                                })}
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <textarea
                                value={rejectReason}
                                onChange={(e) => setRejectReason(e.target.value)}
                                placeholder={t('rejectReasonPlaceholder')}
                                className="h-24 w-full resize-none rounded-md border p-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                autoFocus
                            />
                            <div className="mt-4 flex gap-2">
                                <MyButton
                                    onClick={() => {
                                        setIsRejectDialogOpen(false);
                                        setRejectReason('');
                                        setSelectedCourse(null);
                                    }}
                                    buttonType="secondary"
                                    className="flex-1"
                                >
                                    {t('cancel')}
                                </MyButton>
                                <MyButton
                                    onClick={submitRejection}
                                    buttonType="secondary"
                                    className="flex-1 border-red-600 text-red-600 hover:bg-red-50"
                                    disabled={!rejectReason.trim() || rejectMutation.isPending}
                                >
                                    {rejectMutation.isPending
                                        ? t('rejectingEllipsis')
                                        : t('rejectCourseButton')}
                                </MyButton>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    );
};
