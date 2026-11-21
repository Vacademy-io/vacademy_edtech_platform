import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertCircle, Plus, Minus, Edit, CheckCircle, X } from 'lucide-react';
import { Spinner } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
    isCourseApprovalRequired,
    publishCourse,
    submitForReview,
} from '@/routes/study-library/courses/-services/approval-services';
import { MyButton } from '@/components/design-system/button';
import {
    CourseComparisonResult,
    ComparisonItem,
    PackageSession,
} from '@/types/study-library/course-comparison';
import {
    compareCourses,
    compareCoursesDirectly, // Added new direct approach
    getPackageSessionsForCourse,
} from '@/services/study-library/course-comparison';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

interface CourseComparisonModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentCourseId: string;
    originalCourseId: string | null;
    subjectId: string;
    defaultPackageSessionId?: string;
    chapterId?: string;
}

const getChangeTypeIcon = (changeType: string) => {
    switch (changeType) {
        case 'added':
            return <Plus className="size-4 text-green-600" />;
        case 'deleted':
            return <Minus className="size-4 text-red-600" />;
        case 'updated':
            return <Edit className="size-4 text-blue-600" />;
        case 'unchanged':
            return <CheckCircle className="size-4 text-gray-400" />;
        default:
            return <AlertCircle className="size-4 text-gray-400" />;
    }
};

const getChangeTypeBadge = (changeType: string) => {
    const variants = {
        added: 'bg-green-100 text-green-800 border-green-200',
        deleted: 'bg-red-100 text-red-800 border-red-200',
        updated: 'bg-blue-100 text-blue-800 border-blue-200',
        unchanged: 'bg-gray-100 text-gray-600 border-gray-200',
    };

    return (
        <Badge className={`${variants[changeType as keyof typeof variants]} capitalize`}>
            {changeType}
        </Badge>
    );
};

const ComparisonItemCard: React.FC<{ item: ComparisonItem }> = ({ item }) => {
    return (
        <Card className="border-l-4 border-l-green-500">
            <CardContent className="p-3">
                <div className="flex items-center justify-between">
                    <div className="flex min-w-0 flex-1 items-center space-x-2">
                        <div className="shrink-0 rounded-sm bg-green-50 p-1">
                            {getChangeTypeIcon(item.changeType)}
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <h4 className="truncate text-sm font-medium">{item.name}</h4>
                                {getChangeTypeBadge(item.changeType)}
                            </div>
                            <p className="text-xs capitalize text-gray-500">{item.type}</p>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};

export const CourseComparisonModal: React.FC<CourseComparisonModalProps> = ({
    isOpen,
    onClose,
    currentCourseId,
    originalCourseId,
    subjectId,
    defaultPackageSessionId,
    chapterId,
}) => {
    const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);
    const coursesLower = getTerminologyPlural(
        ContentTerms.Course,
        SystemTerms.Course
    ).toLocaleLowerCase();
    const [packageSessions, setPackageSessions] = useState<PackageSession[]>([]);
    const [selectedPackageSession, setSelectedPackageSession] = useState<string>(
        defaultPackageSessionId || ''
    );

    // Debug state changes
    useEffect(() => {
        console.log('🔄 selectedPackageSession state changed to:', selectedPackageSession);
    }, [selectedPackageSession]);

    // Debug initial values
    useEffect(() => {
        console.log('🔄 Modal mounted with initial values:', {
            defaultPackageSessionId,
            selectedPackageSession,
            currentCourseId,
            originalCourseId,
            subjectId,
            chapterId,
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Empty dependency array to run only on mount

    // TEST: Fetch slides directly using the working API
    useEffect(() => {
        const testFetchSlides = async () => {
            if (chapterId) {
                try {
                    console.log('🧪 TEST: Fetching slides directly for chapterId:', chapterId);

                    // Import authenticatedAxiosInstance dynamically
                    const { default: authenticatedAxiosInstance } = await import(
                        '@/lib/auth/axiosInstance'
                    );
                    const { GET_SLIDES } = await import('@/constants/urls');

                    const response = await authenticatedAxiosInstance.get(
                        `${GET_SLIDES}?chapterId=${chapterId}`
                    );

                    console.log('🧪 TEST: Direct slides API response:', {
                        status: response.status,
                        slidesCount: Array.isArray(response.data)
                            ? response.data.length
                            : 'not array',
                        slides: response.data,
                    });
                } catch (error) {
                    console.error('🧪 TEST: Error fetching slides directly:', error);
                }
            }
        };

        if (isOpen && chapterId) {
            testFetchSlides();
        }
    }, [isOpen, chapterId]);
    const [comparisonResult, setComparisonResult] = useState<CourseComparisonResult | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const navigate = useNavigate();

    // Role toggle: off (default) publishes the draft directly; on routes it
    // through Submit for Review -> admin approval.
    const requireApproval = isCourseApprovalRequired();

    // Send for approval / direct publish mutation
    const submitMutation = useMutation({
        mutationFn: (courseId: string) =>
            requireApproval ? submitForReview(courseId) : publishCourse(courseId),
        onSuccess: () => {
            toast.success(
                requireApproval
                    ? `${courseTerm} submitted for review successfully!`
                    : `${courseTerm} published successfully!`
            );
            // Land on the tab where the course now shows up
            navigate({
                to: '/study-library/courses',
                search: { selectedTab: requireApproval ? 'CourseInReview' : 'AuthoredCourses' },
            });
            // Close the modal
            onClose();
        },
        onError: (error: Error) => {
            toast.error(
                error.message ||
                    (requireApproval
                        ? `Failed to submit ${courseTerm.toLocaleLowerCase()} for review`
                        : `Failed to publish ${courseTerm.toLocaleLowerCase()}`)
            );
        },
    });

    const handleSubmitForApproval = () => {
        submitMutation.mutate(currentCourseId);
    };

    const fetchPackageSessions = useCallback(async () => {
        try {
            console.log('🔄 fetchPackageSessions called for courseId:', currentCourseId);
            const sessions = await getPackageSessionsForCourse(currentCourseId, subjectId);
            console.log('📊 Got sessions:', sessions);
            setPackageSessions(sessions);

            if (sessions.length === 1) {
                const sessionId = sessions[0]?.id || '';
                console.log('🎯 Setting selectedPackageSession to:', sessionId);

                setSelectedPackageSession(sessionId);
            } else if (defaultPackageSessionId) {
                console.log(
                    '🎯 Setting selectedPackageSession to default:',
                    defaultPackageSessionId
                );
                setSelectedPackageSession(defaultPackageSessionId);
            } else {
                console.log('❌ No session found to set as selected');
            }
        } catch (error) {
            console.error('Failed to fetch package sessions:', error);
            toast.error('Failed to load package sessions');
        }
    }, [currentCourseId, defaultPackageSessionId, subjectId]);

    const fetchComparison = useCallback(async () => {
        console.log('🔄 fetchComparison called with:', {
            selectedPackageSession,
            currentCourseId,
            originalCourseId,
            subjectId,
        });

        if (!selectedPackageSession) {
            console.log('❌ No selectedPackageSession, skipping comparison');
            return;
        }

        console.log('✅ Starting comparison...');
        setIsLoading(true);
        setError(null);

        try {
            // Use direct approach if chapterId is available, otherwise use modules approach
            if (chapterId) {
                console.log('🚀 Using DIRECT comparison approach with chapterId:', chapterId);
                const result = await compareCoursesDirectly(
                    currentCourseId,
                    originalCourseId, // This can be null for new courses
                    chapterId
                );
                console.log('✅ DIRECT comparison completed:', result);
                setComparisonResult(result);
            } else {
                console.log('🔄 Using MODULES comparison approach (fallback)');
                const result = await compareCourses(
                    currentCourseId,
                    originalCourseId, // This can be null for new courses
                    subjectId,
                    selectedPackageSession
                );
                console.log('✅ MODULES comparison completed:', result);
                setComparisonResult(result);
            }
        } catch (error) {
            console.error('Failed to compare courses:', error);
            setError(`Failed to compare ${coursesLower}. Please try again.`);
            toast.error(`Failed to compare ${coursesLower}`);
        } finally {
            setIsLoading(false);
        }
    }, [currentCourseId, originalCourseId, subjectId, selectedPackageSession, chapterId]);

    const handleClose = () => {
        setComparisonResult(null);
        setError(null);
        onClose();
    };

    // Fetch package sessions on modal open
    useEffect(() => {
        if (isOpen && currentCourseId) {
            fetchPackageSessions();
        }
    }, [isOpen, currentCourseId, fetchPackageSessions]);

    // Fetch comparison when package session is selected
    useEffect(() => {
        console.log('🔄 useEffect triggered for selectedPackageSession:', selectedPackageSession);
        if (selectedPackageSession) {
            console.log('✅ Calling fetchComparison from useEffect');
            fetchComparison();
        } else {
            console.log('❌ No selectedPackageSession in useEffect');
        }
    }, [selectedPackageSession, fetchComparison]);

    // Alternative trigger: when modal is open and we have sessions
    useEffect(() => {
        console.log('🔄 Alternative trigger useEffect:', {
            isOpen,
            hasPackageSessions: packageSessions.length > 0,
            selectedPackageSession,
            comparisonResult: !!comparisonResult,
        });

        if (
            isOpen &&
            packageSessions.length > 0 &&
            selectedPackageSession &&
            !comparisonResult &&
            !isLoading
        ) {
            console.log('🚀 Alternative trigger: calling fetchComparison');
            fetchComparison();
        }
    }, [
        isOpen,
        packageSessions,
        selectedPackageSession,
        comparisonResult,
        isLoading,
        fetchComparison,
    ]);

    // For new courses (no original course ID), we still want to show all content as "added"
    const isNewCourse = !originalCourseId;

    return (
        <Dialog open={isOpen} onOpenChange={handleClose}>
            <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col p-0">
                {/* Fixed Header */}
                <DialogHeader className="shrink-0 border-b border-gray-200 px-6 py-4">
                    {/* Title Row */}
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex min-w-0 items-center gap-3">
                            <div className="shrink-0 rounded-lg bg-blue-50 p-2">
                                <Edit className="size-4 text-blue-600" />
                            </div>
                            <div className="min-w-0">
                                <h2 className="truncate text-lg font-semibold text-gray-900">
                                    {isNewCourse
                                        ? `${courseTerm} Content Overview`
                                        : 'Preview Changes'}
                                </h2>
                                <p className="mt-0.5 text-xs text-gray-500">
                                    {isNewCourse
                                        ? requireApproval
                                            ? `Review your ${courseTerm.toLocaleLowerCase()} content before submitting for approval`
                                            : `Review your ${courseTerm.toLocaleLowerCase()} content before publishing`
                                        : `Compare your draft ${courseTerm.toLocaleLowerCase()} with the published version`}
                                </p>
                            </div>
                        </div>

                        {/* Send for Approval Button - Only show for new courses */}
                        {isNewCourse &&
                            comparisonResult &&
                            comparisonResult.summary.totalAdded > 0 && (
                                <div className="shrink-0">
                                    <MyButton
                                        buttonType="primary"
                                        size="sm"
                                        onClick={handleSubmitForApproval}
                                        disabled={submitMutation.isPending || isLoading}
                                        className="min-w-fit whitespace-nowrap bg-green-600 px-3 py-2 text-xs shadow-sm hover:bg-green-700"
                                    >
                                        {submitMutation.isPending ? (
                                            <div className="flex items-center gap-1.5">
                                                <Spinner size={12} className="animate-spin" />
                                                <span>
                                                    {requireApproval
                                                        ? 'Submitting...'
                                                        : 'Publishing...'}
                                                </span>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-1.5">
                                                <CheckCircle size={12} />
                                                <span>
                                                    {requireApproval
                                                        ? 'Send for Approval'
                                                        : 'Publish'}
                                                </span>
                                            </div>
                                        )}
                                    </MyButton>
                                </div>
                            )}
                    </div>
                </DialogHeader>

                {/* Scrollable Content */}
                <div className="flex flex-1 flex-col overflow-hidden">
                    <ScrollArea className="flex-1 px-6 py-4">
                        <div className="space-y-4">
                            {/* Package Session Selector */}
                            {packageSessions.length > 1 && (
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">
                                        Select Package Session
                                    </label>
                                    <Select
                                        value={selectedPackageSession}
                                        onValueChange={setSelectedPackageSession}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select a package session" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {packageSessions.map((session) => (
                                                <SelectItem key={session.id} value={session.id}>
                                                    {session.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}

                            {/* Loading State */}
                            {isLoading && (
                                <div className="flex justify-center py-8">
                                    <div className="text-center">
                                        <DashboardLoader size={32} />
                                        <p className="mt-4 text-gray-600">
                                            Comparing {coursesLower}...
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Error State */}
                            {error && (
                                <div className="flex justify-center py-8">
                                    <div className="text-center">
                                        <X className="mx-auto mb-4 size-12 text-red-400" />
                                        <p className="text-red-600">{error}</p>
                                    </div>
                                </div>
                            )}

                            {/* Comparison Results */}
                            {comparisonResult && !isLoading && (
                                <div className="space-y-4">
                                    {/* Summary Cards */}
                                    <div
                                        className={`grid gap-3 ${isNewCourse ? 'grid-cols-1' : 'grid-cols-4'}`}
                                    >
                                        <Card className="border-l-4 border-l-green-500">
                                            <CardContent className="p-3">
                                                <div className="flex items-center space-x-3">
                                                    <div className="rounded-md bg-green-50 p-1.5">
                                                        <Plus className="size-3 text-green-600" />
                                                    </div>
                                                    <div>
                                                        <p className="text-lg font-bold text-green-600">
                                                            {comparisonResult.summary.totalAdded}
                                                        </p>
                                                        <p className="text-xs text-gray-600">
                                                            {isNewCourse
                                                                ? 'Items Created'
                                                                : 'Added'}
                                                        </p>
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </Card>

                                        {!isNewCourse && (
                                            <>
                                                <Card>
                                                    <CardContent className="p-4">
                                                        <div className="flex items-center space-x-2">
                                                            <Edit className="size-4 text-blue-600" />
                                                            <div>
                                                                <p className="text-2xl font-bold text-blue-600">
                                                                    {
                                                                        comparisonResult.summary
                                                                            .totalUpdated
                                                                    }
                                                                </p>
                                                                <p className="text-sm text-gray-600">
                                                                    Updated
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </CardContent>
                                                </Card>

                                                <Card>
                                                    <CardContent className="p-4">
                                                        <div className="flex items-center space-x-2">
                                                            <Minus className="size-4 text-red-600" />
                                                            <div>
                                                                <p className="text-2xl font-bold text-red-600">
                                                                    {
                                                                        comparisonResult.summary
                                                                            .totalDeleted
                                                                    }
                                                                </p>
                                                                <p className="text-sm text-gray-600">
                                                                    Deleted
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </CardContent>
                                                </Card>

                                                <Card>
                                                    <CardContent className="p-4">
                                                        <div className="flex items-center space-x-2">
                                                            <CheckCircle className="size-4 text-gray-400" />
                                                            <div>
                                                                <p className="text-2xl font-bold text-gray-600">
                                                                    {
                                                                        comparisonResult.summary
                                                                            .totalUnchanged
                                                                    }
                                                                </p>
                                                                <p className="text-sm text-gray-600">
                                                                    Unchanged
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </CardContent>
                                                </Card>
                                            </>
                                        )}
                                    </div>

                                    {/* Detailed Comparison */}
                                    <Tabs defaultValue="slides" className="w-full">
                                        <TabsList className="grid h-9 w-full grid-cols-3">
                                            <TabsTrigger value="modules" className="text-xs">
                                                {getTerminology(
                                                    ContentTerms.Modules,
                                                    SystemTerms.Modules
                                                )}
                                                s ({comparisonResult.modules.length})
                                            </TabsTrigger>
                                            <TabsTrigger value="chapters" className="text-xs">
                                                {getTerminologyPlural(
                                                    ContentTerms.Chapters,
                                                    SystemTerms.Chapters
                                                )}{' '}
                                                ({comparisonResult.chapters.length})
                                            </TabsTrigger>
                                            <TabsTrigger value="slides" className="text-xs">
                                                {getTerminology(
                                                    ContentTerms.Slides,
                                                    SystemTerms.Slides
                                                )}
                                                s ({comparisonResult.slides.length})
                                            </TabsTrigger>
                                        </TabsList>

                                        <TabsContent value="modules" className="mt-3">
                                            <div className="max-h-64 overflow-auto">
                                                {comparisonResult.modules.length > 0 ? (
                                                    <div className="space-y-2">
                                                        {comparisonResult.modules.map((item) => (
                                                            <ComparisonItemCard
                                                                key={item.id}
                                                                item={item}
                                                            />
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <p className="py-4 text-center text-sm text-gray-500">
                                                        No modules to compare
                                                    </p>
                                                )}
                                            </div>
                                        </TabsContent>

                                        <TabsContent value="chapters" className="mt-3">
                                            <div className="max-h-64 overflow-auto">
                                                {comparisonResult.chapters.length > 0 ? (
                                                    <div className="space-y-2">
                                                        {comparisonResult.chapters.map((item) => (
                                                            <ComparisonItemCard
                                                                key={item.id}
                                                                item={item}
                                                            />
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <p className="py-4 text-center text-sm text-gray-500">
                                                        No{' '}
                                                        {getTerminologyPlural(
                                                            ContentTerms.Chapters,
                                                            SystemTerms.Chapters
                                                        ).toLocaleLowerCase()}{' '}
                                                        to compare
                                                    </p>
                                                )}
                                            </div>
                                        </TabsContent>

                                        <TabsContent value="slides" className="mt-3">
                                            <div className="max-h-64 overflow-auto">
                                                {comparisonResult.slides.length > 0 ? (
                                                    <div className="space-y-2">
                                                        {comparisonResult.slides.map((item) => (
                                                            <ComparisonItemCard
                                                                key={item.id}
                                                                item={item}
                                                            />
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <p className="py-4 text-center text-sm text-gray-500">
                                                        No slides to compare
                                                    </p>
                                                )}
                                            </div>
                                        </TabsContent>
                                    </Tabs>
                                </div>
                            )}
                        </div>
                    </ScrollArea>
                </div>
            </DialogContent>
        </Dialog>
    );
};
