import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { liveShipment } from '@/routes/commerce/orders/-shared/order-actions';
import { changeShipmentStatus } from '@/routes/commerce/orders/-shared/order-api';
import { todayIso } from '@/routes/commerce/orders/-shared/order-format';
import type { ShipmentStatusBody } from '@/routes/commerce/orders/-shared/order-types';
import { DialogButtons, Field, OrderErrorAlert, TextAreaField, inputClass } from '../order-ui';
import type { OrderDialogProps } from './dialog-types';
import { useDialogWrite } from './use-dialog-write';

/** The local calendar date of an instant, or null. */
export const localDateOf = (iso: string | null | undefined): string | null => {
    if (!iso) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    const time = Date.parse(iso);
    return Number.isFinite(time) ? todayIso(new Date(time)) : null;
};

/** Mark delivered on a date: not after today, not before the parcel was shipped. */
export function DeliverDialog({ open, onOpenChange, detail }: OrderDialogProps) {
    const { t } = useTranslation('commerce');
    const shipment = liveShipment(detail);
    const today = todayIso();
    const shippedOn = localDateOf(shipment?.shipped_at);
    const [date, setDate] = useState(today);
    const [note, setNote] = useState('');
    const write = useDialogWrite(
        (body: ShipmentStatusBody) => changeShipmentStatus(shipment?.id ?? '', body),
        { open, onOpenChange, currency: detail.order.currency, prefix: 'dlv' }
    );
    useEffect(() => {
        if (open) {
            setDate(todayIso());
            setNote('');
        }
    }, [open]);

    const problem = !date
        ? 'orders.dialogs.deliver.dateRequired'
        : date > today
          ? 'orders.dialogs.deliver.dateFuture'
          : shippedOn && date < shippedOn
            ? 'orders.dialogs.deliver.dateBeforeShipped'
            : null;

    const submit = async () => {
        if (problem || !shipment) return;
        const done = await write.submit({
            to: 'DELIVERED',
            delivered_on: date,
            ...(note.trim() ? { note: note.trim() } : {}),
        });
        if (done) {
            toast.success(t('orders.dialogs.deliver.done'));
            write.close();
        }
    };

    return (
        <MyDialog
            heading={t('orders.actions.DELIVER')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-md"
            footer={
                <DialogButtons onCancel={() => onOpenChange(false)}>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disable={!!problem || !shipment}
                        onAsyncClick={submit}
                    >
                        {t('orders.actions.DELIVER')}
                    </MyButton>
                </DialogButtons>
            }
        >
            <div className="flex flex-col gap-4">
                <Field
                    label={t('orders.bulk.deliveredOn')}
                    htmlFor="deliver-date"
                    required
                    error={problem ? t(problem) : null}
                >
                    <input
                        id="deliver-date"
                        type="date"
                        className={inputClass}
                        value={date}
                        max={today}
                        min={shippedOn ?? undefined}
                        onChange={(event) => setDate(event.target.value)}
                    />
                </Field>
                <TextAreaField id="deliver-note" label={t('orders.note')} value={note} onChange={setNote} />
                <OrderErrorAlert error={write.error} currency={detail.order.currency} />
            </div>
        </MyDialog>
    );
}
