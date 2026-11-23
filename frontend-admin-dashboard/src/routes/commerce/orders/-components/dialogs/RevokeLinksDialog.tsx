import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { revokeOrderLinks } from '@/routes/commerce/orders/-shared/order-api';
import type { OrderError } from '@/routes/commerce/orders/-shared/order-errors';
import { DialogButtons, OrderErrorAlert, useOrderErrorHandler } from '../order-ui';
import type { OrderDialogProps } from './dialog-types';

/** Close every order link already sent to the customer (manager). */
export function RevokeLinksDialog({ open, onOpenChange, detail }: OrderDialogProps) {
    const { t } = useTranslation('commerce');
    const handle = useOrderErrorHandler();
    const [error, setError] = useState<OrderError | null>(null);
    useEffect(() => {
        if (open) setError(null);
    }, [open]);

    const submit = async () => {
        setError(null);
        try {
            await revokeOrderLinks(detail.order.id);
            toast.success(t('orders.dialogs.revoke.done'));
            onOpenChange(false);
        } catch (raw) {
            setError(handle(raw, { close: () => onOpenChange(false) }));
        }
    };

    return (
        <MyDialog
            heading={t('orders.actions.REVOKE_LINKS')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-md"
            footer={
                <DialogButtons onCancel={() => onOpenChange(false)}>
                    <MyButton type="button" buttonType="primary" scale="medium" onAsyncClick={submit}>
                        {t('orders.dialogs.revoke.submit')}
                    </MyButton>
                </DialogButtons>
            }
        >
            <div className="flex flex-col gap-4">
                <p className="text-body text-foreground">{t('orders.dialogs.revoke.help')}</p>
                <OrderErrorAlert error={error} />
            </div>
        </MyDialog>
    );
}
