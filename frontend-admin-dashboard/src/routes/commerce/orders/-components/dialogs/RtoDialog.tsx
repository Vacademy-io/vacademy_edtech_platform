import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { PlainSelect } from '@/routes/commerce/-components/CatalogueBits';
import { liveShipment } from '@/routes/commerce/orders/-shared/order-actions';
import { changeShipmentStatus } from '@/routes/commerce/orders/-shared/order-api';
import { RTO_REASONS, type ShipmentStatusBody } from '@/routes/commerce/orders/-shared/order-types';
import { DialogButtons, OrderErrorAlert, OrderNotice, TextAreaField } from '../order-ui';
import type { OrderDialogProps } from './dialog-types';
import { useDialogWrite } from './use-dialog-write';

/** The courier is bringing the parcel back: why. Stock returns only on receipt. */
export function RtoDialog({ open, onOpenChange, detail }: OrderDialogProps) {
    const { t } = useTranslation('commerce');
    const shipment = liveShipment(detail);
    const [reason, setReason] = useState('');
    const [note, setNote] = useState('');
    const [touched, setTouched] = useState(false);
    const write = useDialogWrite(
        (body: ShipmentStatusBody) => changeShipmentStatus(shipment?.id ?? '', body),
        { open, onOpenChange, currency: detail.order.currency, prefix: 'rto' }
    );
    useEffect(() => {
        if (open) {
            setReason('');
            setNote('');
            setTouched(false);
        }
    }, [open]);

    const reasonMissing = !reason;
    const noteMissing = reason === 'OTHER' && !note.trim();
    const submit = async () => {
        setTouched(true);
        if (reasonMissing || noteMissing || !shipment) return;
        const done = await write.submit({
            to: 'RTO',
            rto_reason: reason,
            ...(note.trim() ? { note: note.trim() } : {}),
        });
        if (done) {
            toast.success(t('orders.dialogs.rto.done'));
            write.close();
        }
    };

    return (
        <MyDialog
            heading={t('orders.actions.RTO')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-md"
            footer={
                <DialogButtons onCancel={() => onOpenChange(false)}>
                    <MyButton type="button" buttonType="primary" scale="medium" disable={!shipment} onAsyncClick={submit}>
                        {t('orders.actions.RTO')}
                    </MyButton>
                </DialogButtons>
            }
        >
            <div className="flex flex-col gap-4">
                <OrderNotice tone="warning">{t('orders.dialogs.rto.stockNote')}</OrderNotice>
                <PlainSelect
                    label={t('orders.reason')}
                    value={reason}
                    onChange={setReason}
                    options={RTO_REASONS.map((value) => ({ value, label: t(`orders.rto.reasons.${value}`) }))}
                    invalid={touched && reasonMissing}
                />
                {touched && reasonMissing && (
                    <p role="alert" className="text-caption text-danger-600">
                        {t('orders.dialogs.reasonRequired')}
                    </p>
                )}
                <TextAreaField
                    id="rto-note"
                    label={t('orders.note')}
                    value={note}
                    onChange={setNote}
                    required={reason === 'OTHER'}
                    error={touched && noteMissing ? t('orders.dialogs.rto.noteRequired') : null}
                />
                <OrderErrorAlert error={write.error} currency={detail.order.currency} />
            </div>
        </MyDialog>
    );
}
