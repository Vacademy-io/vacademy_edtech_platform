import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Phone } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { itemLines, serverActions } from '@/routes/commerce/orders/-shared/order-actions';
import { transitionOrder } from '@/routes/commerce/orders/-shared/order-api';
import { codToCollect, formatQuantity } from '@/routes/commerce/orders/-shared/order-format';
import type { TransitionBody } from '@/routes/commerce/orders/-shared/order-types';
import { OrderErrorAlert, TextAreaField, money } from '../order-ui';
import type { OrderDialogProps } from './dialog-types';
import { useDialogWrite } from './use-dialog-write';

/**
 * "Confirm COD by phone" (contract §5.6.1): who to call, what to collect and
 * where it goes; Confirm order, or "Customer said no" when cancelling is offered.
 */
export function ConfirmCodDialog({
    open,
    onOpenChange,
    detail,
    onDecline,
}: OrderDialogProps & { onDecline?: () => void }) {
    const { t } = useTranslation('commerce');
    const order = detail.order;
    const [note, setNote] = useState('');
    const write = useDialogWrite((body: TransitionBody) => transitionOrder(order.id, body), {
        open,
        onOpenChange,
        currency: order.currency,
        prefix: 'cnf',
    });
    useEffect(() => {
        if (open) setNote('');
    }, [open]);

    const canDecline = !!onDecline && serverActions(detail).includes('CANCEL');
    const address = detail.shipping_address;
    const phone = order.customer_phone ?? address?.phone ?? null;

    const confirm = async () => {
        const done = await write.submit({
            from_status: order.status,
            to_status: 'CONFIRMED',
            ...(note.trim() ? { note: note.trim() } : {}),
        });
        if (done) {
            toast.success(t('orders.dialogs.confirm.done', { number: order.order_number }));
            write.close();
        }
    };

    return (
        <MyDialog
            heading={t('orders.dialogs.confirm.title', { number: order.order_number })}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-lg"
            className="h-full sm:h-auto"
            footer={
                <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    {canDecline && (
                        <MyButton type="button" buttonType="secondary" scale="medium" onClick={onDecline}>
                            {t('orders.cod.customerSaidNo')}
                        </MyButton>
                    )}
                    <MyButton type="button" buttonType="primary" scale="medium" onAsyncClick={confirm}>
                        {t('orders.actions.CONFIRM')}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                    <span className="text-caption text-muted-foreground">{t('orders.dialogs.confirm.customer')}</span>
                    <span className="text-title text-foreground">{order.customer_name ?? '—'}</span>
                    {phone && (
                        <div className="flex flex-wrap items-center gap-3">
                            <span className="text-h3 tabular-nums text-foreground">{phone}</span>
                            <a
                                href={`tel:${phone}`}
                                className="flex h-12 items-center gap-2 rounded-md border border-primary-500 px-4 text-body text-primary-500 hover:bg-primary-50"
                            >
                                <Phone size={18} />
                                {t('orders.cod.call')}
                            </a>
                        </div>
                    )}
                </div>
                <p className="rounded-lg bg-warning-50 p-3 text-title text-warning-600">
                    {t('orders.cod.collect', { amount: money(codToCollect(order), order.currency) })}
                </p>
                {address && (
                    <p className="text-body text-foreground">
                        <span className="text-caption text-muted-foreground">{t('orders.dialogs.confirm.deliverTo')} </span>
                        {[address.city, address.pincode].filter(Boolean).join(', ') || '—'}
                    </p>
                )}
                <ul className="flex flex-col gap-1 text-body text-foreground">
                    {itemLines(detail).map((line) => (
                        <li key={line.id} className="flex justify-between gap-3">
                            <span className="min-w-0 truncate">
                                {line.name}
                                {line.variant_label ? ` · ${line.variant_label}` : ''}
                            </span>
                            <span className="shrink-0 tabular-nums">
                                {formatQuantity(line.quantity - line.qty_cancelled, line.qty_scale, line.unit, t)}
                            </span>
                        </li>
                    ))}
                </ul>
                <TextAreaField id="confirm-note" label={t('orders.note')} value={note} onChange={setNote} />
                <OrderErrorAlert error={write.error} currency={order.currency} />
            </div>
        </MyDialog>
    );
}
