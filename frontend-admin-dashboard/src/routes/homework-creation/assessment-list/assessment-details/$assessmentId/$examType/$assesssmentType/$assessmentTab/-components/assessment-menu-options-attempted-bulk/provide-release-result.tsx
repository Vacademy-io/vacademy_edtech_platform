import { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { useSubmissionsBulkActionsDialogStoreAttempted } from '../bulk-actions-zustand-store/useSubmissionsBulkActionsDialogStoreAttempted';
import { useMutation } from '@tanstack/react-query';
import { SelectedReleaseResultFilterInterface } from '../AssessmentSubmissionsTab';
import { getReleaseStudentResult } from '../../-services/assessment-details-services';
import { toast } from 'sonner';
import { Route } from '../..';
import { getInstituteId } from '@/constants/helper';

interface ProvideDialogDialogProps {
    trigger: ReactNode;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

const ProvideReleaseResultDialogContent = () => {
    const { t } = useTranslation('homeworkCreationProvideReleaseResult');
    const { selectedStudent, bulkActionInfo, isBulkAction, closeAllDialogs } =
        useSubmissionsBulkActionsDialogStoreAttempted();
    const { assessmentId } = Route.useParams();
    const instituteId = getInstituteId();
    const displayText = isBulkAction ? bulkActionInfo?.displayText : selectedStudent?.student_name;

    const getReleaseResultMutation = useMutation({
        mutationFn: ({
            assessmentId,
            instituteId,
            methodType,
            selectedFilter,
        }: {
            assessmentId: string;
            instituteId: string | undefined;
            methodType: string;
            selectedFilter: SelectedReleaseResultFilterInterface;
        }) => getReleaseStudentResult(assessmentId, instituteId, methodType, selectedFilter),
        onSuccess: () => {
            toast.success(t('toasts.releaseSuccess'), {
                className: 'success-toast',
                duration: 4000,
            });
            closeAllDialogs();
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    const handleSubmit = () => {
        if (isBulkAction && bulkActionInfo?.selectedStudents) {
            getReleaseResultMutation.mutate({
                assessmentId,
                instituteId,
                methodType: 'PARTICIPANTS',
                selectedFilter: {
                    attempt_ids: bulkActionInfo.selectedStudents.map(
                        (student) => student.attempt_id
                    ),
                },
            });
        } else if (selectedStudent) {
            console.log('individual student');
        }
        closeAllDialogs();
    };

    return (
        <div className="flex flex-col gap-6 px-4 pb-2 text-neutral-600">
            <h1>
                <Trans
                    i18nKey="dialog.confirmMessage"
                    t={t}
                    values={{ name: displayText }}
                    components={{ highlight: <span className="text-primary-500" /> }}
                />
            </h1>
            <MyButton
                buttonType="primary"
                scale="large"
                layoutVariant="default"
                onClick={handleSubmit}
            >
                {t('doneButton')}
            </MyButton>
        </div>
    );
};

export const ProvideReleaseResultDialog = ({
    trigger,
    open,
    onOpenChange,
}: ProvideDialogDialogProps) => {
    const { t } = useTranslation('homeworkCreationProvideReleaseResult');
    return (
        <MyDialog
            trigger={trigger}
            heading={t('dialog.heading')}
            dialogWidth="w-96 max-w-sm"
            content={<ProvideReleaseResultDialogContent />}
            open={open}
            onOpenChange={onOpenChange}
        />
    );
};
