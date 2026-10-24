import { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { useSubmissionsBulkActionsDialogStoreOngoing } from '../bulk-actions-zustand-store/useSubmissionsBulkActionsDialogStoreOngoing';

interface ProvideDialogDialogProps {
    trigger: ReactNode;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

const CloseSubmissionDialogContent = () => {
    const { t } = useTranslation('homeworkCreationCloseSubmissionComponent');
    const { selectedStudent, bulkActionInfo, isBulkAction, closeAllDialogs } =
        useSubmissionsBulkActionsDialogStoreOngoing();

    const displayText = isBulkAction ? bulkActionInfo?.displayText : selectedStudent?.student_name;

    const handleSubmit = () => {
        if (isBulkAction && bulkActionInfo?.selectedStudents) {
            console.log('bulk actions');
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

export const CloseSubmissionDialog = ({
    trigger,
    open,
    onOpenChange,
}: ProvideDialogDialogProps) => {
    const { t } = useTranslation('homeworkCreationCloseSubmissionComponent');
    return (
        <MyDialog
            trigger={trigger}
            heading={t('dialog.heading')}
            dialogWidth="w-96 max-w-sm"
            content={<CloseSubmissionDialogContent />}
            open={open}
            onOpenChange={onOpenChange}
        />
    );
};
