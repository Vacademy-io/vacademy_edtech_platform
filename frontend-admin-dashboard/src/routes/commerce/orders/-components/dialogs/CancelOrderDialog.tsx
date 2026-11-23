import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { transitionOrder } from '@/routes/commerce/orders/-shared/order-api';
import type { TransitionBody } from '@/routes/commerce/orders/-shared/order-types';
import { DialogButtons, OrderErrorAlert, OrderNotice, TextAreaField, money } from '../order-ui';
import type { OrderDialogProps } from './dialog-types';
import { useDialogWrite } from './use-dialog-write';

/** Cancel the whole order with a reason; says what happens to money, stock and the invoice. */
export function CancelOrderDialog({
    open,
    onOpenChange,
    detail,
    defaultReason,
}: OrderDialogProps & { defaultReason?: string }) {
    const { t } = useTranslation('commerce');
    const order = detail.order;
    const [reason, setReason] = useState('');
    const [touched, setTouched] = useState(false);
    const write = useDialogWrite((body: TransitionBody) => transitionOrder(order.id, body), {
        open,
        onOpenChange,
        currency: order.currency,
        prefix: 'cxl',
    });
    useEffect(() => {
        if (open) {
            setReason(defaultReason ?? '');
            setTouched(false);
        }
    }, [open, defaultReason]);

    const missing = !reason.trim();
    const submit = async () => {
        setTouched(true);
        if (missing) return;
        const done = await write.submit({
            from_status: order.status,
            to_status: 'CANCELLED',
            reason: reason.trim(),
        });
        if (done) {
            toast.success(t('orders.dialogs.cancel.done', { number: order.order_number }));
            write.close();
        }
    };

    return (
        <MyDialog
            heading={t('orders.dialogs.cancel.title', { number: order.order_number })}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-lg"
            footer={
                <DialogButtons onCancel={() => onOpenChange(false)}>
                    <MyButton type="button" buttonType="primary" scale="medium" onAsyncClick={submit}>
                        {t('orders.actions.CANCEL')}
                    </MyButton>
                </DialogButtons>
            }
        >
            <div className="flex flex-col gap-4">
                <ul className="flex list-disc flex-col gap-1 ps-5 text-body text-foreground">
                    {order.amount_paid > 0 && (
                        <li>{t('orders.dialogs.cancel.paidBack', { amount: money(order.amount_paid, order.currency) })}</li>
                    )}
                    <li>{t('orders.dialogs.cancel.stockBack')}</li>
                    {detail.invoice_id && <li>{t('orders.dialogs.cancel.creditNote')}</li>}
                </ul>
                <TextAreaField
                    id="cancel-reason"
                    label={t('orders.reason')}
                    value={reason}
                    onChange={setReason}
                    required
                    error={touched && missing ? t('orders.dialogs.reasonRequired') : null}
                />
                {order.amount_paid > 0 && (
                    <OrderNotice tone="info">{t('orders.dialogs.cancel.refundAfter')}</OrderNotice>
                )}
                <OrderErrorAlert error={write.error} currency={order.currency} />
            </div>
        </MyDialog>
    );
}
