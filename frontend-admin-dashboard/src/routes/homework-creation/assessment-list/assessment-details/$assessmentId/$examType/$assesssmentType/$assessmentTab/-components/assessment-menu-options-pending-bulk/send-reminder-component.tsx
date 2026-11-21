import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { useSubmissionsBulkActionsDialogStorePending } from '../bulk-actions-zustand-store/useSubmissionsBulkActionsDialogStorePending';

interface ProvideDialogDialogProps {
    trigger: ReactNode;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

const SendReminderDialogContent = () => {
    const { t } = useTranslation('homeworkCreationSendReminderComponent');
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
                {t('confirmPrefix')}&nbsp;
                <span className="text-primary-500">{displayText}</span>&nbsp;{t('confirmSuffix')}
            </h1>
            <MyButton
                buttonType="primary"
                scale="large"
                layoutVariant="default"
                onClick={handleSubmit}
            >
                {t('done')}
            </MyButton>
        </div>
    );
};

export const SendReminderDialog = ({ trigger, open, onOpenChange }: ProvideDialogDialogProps) => {
    const { t } = useTranslation('homeworkCreationSendReminderComponent');
    return (
        <MyDialog
            trigger={trigger}
            heading={t('heading')}
            dialogWidth="w-96 max-w-sm"
            content={<SendReminderDialogContent />}
            open={open}
            onOpenChange={onOpenChange}
        />
    );
};
