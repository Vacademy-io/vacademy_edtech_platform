import React, { useState } from 'react';
import { MyButton } from '@/components/design-system/button';
import { CheckCircle, Eye, Spinner } from '@phosphor-icons/react';
import { useMutation } from '@tanstack/react-query';
import {
    isCourseApprovalRequired,
    publishCourse,
    submitForReview,
} from '@/routes/study-library/courses/-services/approval-services';
import { toast } from 'sonner';
import { useNavigate } from '@tanstack/react-router';
import { ChangesPreviewModal } from './ChangesPreviewModal';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

interface SendForApprovalButtonProps {
    courseId: string;
    hasChanges: boolean;
    disabled?: boolean;
}

export function SendForApprovalButton({
    courseId,
    hasChanges,
    disabled = false,
}: SendForApprovalButtonProps) {
    const [showPreview, setShowPreview] = useState(false);
    const navigate = useNavigate();
    // Role toggle: off (default) publishes the draft directly; on routes it
    // through Submit for Review -> admin approval.
    const requireApproval = isCourseApprovalRequired();
    const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);

    // Submit for review / direct publish mutation
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

    const handlePreviewChanges = () => {
        setShowPreview(true);
    };

    const handleSubmitForApproval = () => {
        submitMutation.mutate(courseId);
    };

    if (!hasChanges) {
        return null;
    }

    return (
        <>
            <div className="pointer-events-auto fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] right-[calc(1.5rem+env(safe-area-inset-right))] z-[80]">
                <div className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white/90 p-2 shadow-xl backdrop-blur supports-[backdrop-filter]:bg-white/70">
                    {/* Preview Changes Button */}
                    <MyButton
                        buttonType="secondary"
                        onClick={handlePreviewChanges}
                        disabled={disabled || submitMutation.isPending}
                        className="shadow-lg"
                    >
                        <Eye size={16} className="mr-2" />
                        Preview Changes
                    </MyButton>

                    {/* Send for Approval Button */}
                    <MyButton
                        buttonType="primary"
                        onClick={handleSubmitForApproval}
                        disabled={disabled || submitMutation.isPending}
                        className="bg-green-600 shadow-lg hover:bg-green-700"
                    >
                        {submitMutation.isPending ? (
                            <>
                                <Spinner size={16} className="mr-2 animate-spin" />
                                {requireApproval ? 'Submitting...' : 'Publishing...'}
                            </>
                        ) : (
                            <>
                                <CheckCircle size={16} className="mr-2" />
                                {requireApproval ? 'Send for Approval' : 'Publish'}
                            </>
                        )}
                    </MyButton>
                </div>
            </div>

            {/* Changes Preview Modal */}
            <ChangesPreviewModal
                isOpen={showPreview}
                onClose={() => setShowPreview(false)}
                courseId={courseId}
                onSubmitForApproval={handleSubmitForApproval}
                isSubmitting={submitMutation.isPending}
                requireApproval={requireApproval}
            />
        </>
    );
}
