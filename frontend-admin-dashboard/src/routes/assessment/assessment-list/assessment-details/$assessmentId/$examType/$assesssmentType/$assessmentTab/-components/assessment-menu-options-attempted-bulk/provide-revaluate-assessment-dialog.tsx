import { ReactNode, useState } from 'react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { useSubmissionsBulkActionsDialogStoreAttempted } from '../bulk-actions-zustand-store/useSubmissionsBulkActionsDialogStoreAttempted';
import { Route } from '../..';
import { getInstituteId } from '@/constants/helper';
import { SelectedFilterRevaluateInterface } from '@/types/assessments/assessment-revaluate-question-wise';
import { useMutation } from '@tanstack/react-query';
import { getRevaluateStudentResult } from '../../-services/assessment-details-services';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

interface ProvideDialogDialogProps {
    trigger: ReactNode;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

const ProvideRevaluateAssessmentDialogContent = () => {
    const { t } = useTranslation('assessmentProvideRevaluateDialog');
    const { selectedStudent, bulkActionInfo, isBulkAction, closeAllDialogs } =
        useSubmissionsBulkActionsDialogStoreAttempted();

    const { assessmentId } = Route.useParams();
    const instituteId = getInstituteId();
    const [selectedFilter] = useState<SelectedFilterRevaluateInterface>({
        questions: [
            {
                section_id: '',
                question_ids: [],
            },
        ],
        attempt_ids: [],
    });
    const getRevaluateResultMutation = useMutation({
        mutationFn: ({
            assessmentId,
            instituteId,
            methodType,
            selectedFilter,
        }: {
            assessmentId: string;
            instituteId: string | undefined;
            methodType: string;
            selectedFilter: SelectedFilterRevaluateInterface;
        }) => getRevaluateStudentResult(assessmentId, instituteId, methodType, selectedFilter),
        onSuccess: () => {
            toast.success(t('toasts.revaluateSuccess'), {
                className: 'success-toast',
                duration: 4000,
            });
            closeAllDialogs();
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    const displayText = isBulkAction ? bulkActionInfo?.displayText : selectedStudent?.student_name;

    const handleSubmit = () => {
        if (isBulkAction && bulkActionInfo?.selectedStudents) {
            getRevaluateResultMutation.mutate({
                assessmentId,
                instituteId,
                methodType: 'ENTIRE_ASSESSMENT_PARTICIPANTS',
                selectedFilter: {
                    ...selectedFilter,
                    questions: [
                        {
                            section_id: '',
                            question_ids: [],
                        },
                    ],
                    attempt_ids: bulkActionInfo.selectedStudents.map(
                        (student) => student.attempt_id
                    ),
                },
            });
        } else if (selectedStudent) {
            console.log('individual student');
        }
    };

    return (
        <div className="flex flex-col gap-6 px-4 pb-2 text-neutral-600">
            <h1>
                {t('dialog.confirmTextPrefix')}&nbsp;
                <span className="text-primary-500">{displayText}</span>&nbsp;
                {t('dialog.confirmSuffix')}
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

export const ProvideRevaluateAssessmentDialog = ({
    trigger,
    open,
    onOpenChange,
}: ProvideDialogDialogProps) => {
    const { t } = useTranslation('assessmentProvideRevaluateDialog');
    return (
        <MyDialog
            trigger={trigger}
            heading={t('dialog.heading')}
            dialogWidth="w-full max-w-sm"
            content={<ProvideRevaluateAssessmentDialogContent />}
            open={open}
            onOpenChange={onOpenChange}
        />
    );
};
