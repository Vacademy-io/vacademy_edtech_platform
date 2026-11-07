import { MyDialog } from '@/components/design-system/dialog';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useEnrollRequestsDialogStore } from '../bulk-actions-store';

export const DeclineRequestDialog = () => {
    const { t } = useTranslation('manageStudentsDeclineRequestDialog');
    const { isDeclineRequestOpen, bulkActionInfo, selectedStudent, closeAllDialogs } =
        useEnrollRequestsDialogStore();

    const handleDeclineRequestBulk = async () => {
        if (!bulkActionInfo) return;

        try {
            toast.success(t('toasts.declineSuccess'));
            closeAllDialogs();
        } catch {
            toast.error(t('toasts.declineFailed'));
        }
    };

    const handleDeclineRequest = async () => {
        if (!selectedStudent) return;

        try {
            toast.success(t('toasts.declineSuccess'));
            closeAllDialogs();
        } catch {
            toast.error(t('toasts.declineFailed'));
        }
    };

    return (
        <MyDialog
            heading={t('dialog.title')}
            open={isDeclineRequestOpen}
            onOpenChange={closeAllDialogs}
            footer={
                <div className="flex w-full justify-between gap-2">
                    <button
                        className="rounded-lg border border-neutral-300 px-4 py-2 text-neutral-600 hover:bg-neutral-100"
                        onClick={closeAllDialogs}
                    >
                        {t('buttons.cancel')}
                    </button>
                    <button
                        className="hover:bg-primary-600 rounded-lg bg-primary-500 px-4 py-2 text-white"
                        onClick={selectedStudent ? handleDeclineRequest : handleDeclineRequestBulk}
                    >
                        {t('buttons.decline')}
                    </button>
                </div>
            }
        >
            <div className="flex flex-col gap-4">
                <p className="text-neutral-600">
                    {t('dialog.confirmText', {
                        name: selectedStudent ? selectedStudent?.full_name : bulkActionInfo?.displayText,
                    })}
                </p>
                <p className="text-sm text-neutral-500">{t('dialog.emailNotice')}</p>
            </div>
        </MyDialog>
    );
};
