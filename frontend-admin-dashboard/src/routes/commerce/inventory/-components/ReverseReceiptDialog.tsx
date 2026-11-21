import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { DialogButtons, TextAreaField } from '@/routes/commerce/orders/-components/order-ui';
import { reverseReceipt } from '../-shared/inventory-api';
import { useInvalidateInventory } from '../-shared/inventory-hooks';
import type { ReceiptView } from '../-shared/inventory-types';
import { InventoryErrorNotice, TOUCH } from './inventory-ui';

/**
 * Reverse receipt (manager): the stock goes back out, its pieces become
 * cancelled and its labels still waiting are dropped. A billed receipt is
 * refused with the server's sentence (`RECEIPT_BILLED`).
 */
export function ReverseReceiptDialog({
    open,
    onOpenChange,
    receipt,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    receipt: ReceiptView;
}) {
    const { t } = useTranslation('commerce');
    const invalidate = useInvalidateInventory();
    const [reason, setReason] = useState('');
    const [problem, setProblem] = useState<string | null>(null);
    const [error, setError] = useState<unknown>(null);

    const reverse = async () => {
        setProblem(null);
        setError(null);
        if (!reason.trim()) return setProblem(t('inventory.receipt.reasonRequired'));
        try {
            await reverseReceipt(receipt.id, reason.trim());
            toast.success(t('inventory.receipt.reversed'));
            void invalidate();
            onOpenChange(false);
        } catch (e) {
            setError(e);
        }
    };

    return (
        <MyDialog
            heading={t('inventory.receipt.reverse')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-md"
            footer={
                <DialogButtons onCancel={() => onOpenChange(false)}>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        className={`${TOUCH} bg-danger-600 hover:bg-danger-600`}
                        onAsyncClick={reverse}
                    >
                        {t('inventory.receipt.reverse')}
                    </MyButton>
                </DialogButtons>
            }
        >
            <div className="flex flex-col gap-3">
                <p className="text-body text-foreground">{t('inventory.receipt.reverseHelp')}</p>
                <TextAreaField
                    id="reverse-reason"
                    label={t('inventory.receipt.reason')}
                    value={reason}
                    onChange={setReason}
                    required
                    error={problem}
                    maxLength={500}
                />
                <InventoryErrorNotice error={error} />
            </div>
        </MyDialog>
    );
}
