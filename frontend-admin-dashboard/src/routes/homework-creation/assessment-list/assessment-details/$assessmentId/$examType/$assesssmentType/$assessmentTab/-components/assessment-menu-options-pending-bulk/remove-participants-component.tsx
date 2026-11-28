import { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { useSubmissionsBulkActionsDialogStorePending } from '../bulk-actions-zustand-store/useSubmissionsBulkActionsDialogStorePending';

interface ProvideDialogDialogProps {
    trigger: ReactNode;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

const RemoveParticipantsDialogContent = () => {
    const { t } = useTranslation('homeworkCreationRemoveParticipantsComponent');
    const { selectedStudent, bulkActionInfo, isBulkAction, closeAllDialogs } =
        useSubmissionsBulkActionsDialogStorePending();

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
                    t={t}
                    i18nKey="confirmText"
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

export const RemoveParticipantsDialog = ({
    trigger,
    open,
    onOpenChange,
}: ProvideDialogDialogProps) => {
    const { t } = useTranslation('homeworkCreationRemoveParticipantsComponent');
    return (
        <MyDialog
            trigger={trigger}
            heading={t('heading')}
            dialogWidth="w-96 max-w-sm"
            content={<RemoveParticipantsDialogContent />}
            open={open}
            onOpenChange={onOpenChange}
        />
    );
};
