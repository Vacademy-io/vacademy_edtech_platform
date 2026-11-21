import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Textarea } from '@/components/ui/textarea';
import type { PayrollEntryDTO } from '@/routes/erp/-shared/hr-types';

const MIN_REASON = 4;

interface HoldEntryDialogProps {
    /** The entry to hold; null closes the dialog. */
    entry: PayrollEntryDTO | null;
    onClose: () => void;
    onHold: (entryId: string, reason: string) => Promise<string | null>;
}

/**
 * Hold one employee's payslip out of the run.
 *
 * The reason is mandatory and not a formality: a held entry drops out of the run's
 * net pay, so whoever reconciles the bank transfer a week later needs to know why
 * the total moved. The backend stores it on the entry and it is shown on the row.
 */
export const HoldEntryDialog = ({ entry, onClose, onHold }: HoldEntryDialogProps) => {
    const { t } = useTranslation('erpHoldEntryDialog');
    const [reason, setReason] = useState('');

    useEffect(() => {
        if (entry) setReason('');
    }, [entry]);

    const submit = async () => {
        if (!entry?.id) return;
        const trimmed = reason.trim();
        if (trimmed.length < MIN_REASON) {
            toast.error(t('reasonRequired'));
            return;
        }
        const message = await onHold(entry.id, trimmed);
        if (message === null) return;
        toast.success(message);
        onClose();
    };

    return (
        <MyDialog
            heading={
                entry?.employee_code
                    ? t('headingWithCode', { code: entry.employee_code })
                    : t('heading')
            }
            open={!!entry}
            onOpenChange={(open) => !open && onClose()}
            dialogWidth="max-w-lg"
            footer={
                <>
                    <MyButton buttonType="secondary" scale="medium" onClick={onClose}>
                        {t('cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        onAsyncClick={submit}
                        loadingText={t('holding')}
                    >
                        {t('holdPayslip')}
                    </MyButton>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                <p className="text-body text-neutral-600">{t('description')}</p>
                <div className="flex flex-col gap-2">
                    <label
                        htmlFor="hold-reason"
                        className="text-body font-semibold text-neutral-700"
                    >
                        {t('reasonLabel')} <span className="text-danger-600">*</span>
                    </label>
                    <Textarea
                        id="hold-reason"
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        rows={3}
                        placeholder={t('reasonPlaceholder')}
                    />
                    <p className="text-caption text-neutral-500">{t('reasonHint')}</p>
                </div>
            </div>
        </MyDialog>
    );
};
