import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import { liveShipment } from '@/routes/commerce/orders/-shared/order-actions';
import { patchShipment } from '@/routes/commerce/orders/-shared/order-api';
import { readCouriers, rememberCourier } from '@/routes/commerce/orders/-shared/courier-memory';
import type { TrackingPatchBody } from '@/routes/commerce/orders/-shared/order-types';
import { DialogButtons, Field, OrderErrorAlert } from '../order-ui';
import type { OrderDialogProps } from './dialog-types';
import { type ShipForm, shipProblems } from './ShipDialog';
import { useDialogWrite } from './use-dialog-write';

/** Courier, tracking number and link, prefilled; only changed keys are sent. */
export function EditTrackingDialog({ open, onOpenChange, detail }: OrderDialogProps) {
    const { t } = useTranslation('commerce');
    const shipment = liveShipment(detail);
    const couriers = useMemo(() => (open ? readCouriers() : []), [open]);
    const initial: ShipForm = {
        courier: shipment?.carrier_name ?? '',
        tracking: shipment?.tracking_number ?? '',
        link: shipment?.tracking_url ?? '',
        weight: '',
    };
    const [form, setForm] = useState<ShipForm>(initial);
    const write = useDialogWrite(
        (body: TrackingPatchBody) => patchShipment(shipment?.id ?? '', body),
        { open, onOpenChange, currency: detail.order.currency, prefix: 'trk' }
    );
    useEffect(() => {
        if (open) setForm(initial);
        // Prefill once per opening.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const changes: Omit<TrackingPatchBody, 'client_request_id'> = {};
    if (form.courier.trim() !== initial.courier) changes.carrier_name = form.courier.trim();
    if (form.tracking.trim() !== initial.tracking) changes.tracking_number = form.tracking.trim();
    if (form.link.trim() !== initial.link) changes.tracking_url = form.link.trim();
    const changed = Object.keys(changes).length > 0;
    const problems = shipProblems(form);
    const set = (key: keyof ShipForm) => (event: { target: { value: string } }) =>
        setForm((current) => ({ ...current, [key]: event.target.value }));

    const submit = async () => {
        if (!changed || !shipment || Object.keys(problems).length > 0) return;
        const done = await write.submit(changes);
        if (done) {
            if (changes.carrier_name) rememberCourier(changes.carrier_name);
            toast.success(t('orders.dialogs.tracking.done'));
            write.close();
        }
    };

    return (
        <MyDialog
            heading={t('orders.actions.EDIT_TRACKING')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-lg"
            footer={
                <DialogButtons onCancel={() => onOpenChange(false)}>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disable={!changed || Object.keys(problems).length > 0}
                        onAsyncClick={submit}
                    >
                        {t('common.save')}
                    </MyButton>
                </DialogButtons>
            }
        >
            <div className="flex flex-col gap-4">
                <Field label={t('orders.ship.courier')} htmlFor="trk-courier" required error={problems.courier ? t(problems.courier) : null}>
                    <MyInput id="trk-courier" input={form.courier} onChangeFunction={set('courier')} list="trk-courier-list" maxLength={100} className="sm:w-full" />
                    <datalist id="trk-courier-list">
                        {couriers.map((name) => (
                            <option key={name} value={name} />
                        ))}
                    </datalist>
                </Field>
                <Field label={t('orders.ship.trackingNumber')} htmlFor="trk-number" required error={problems.tracking ? t(problems.tracking) : null}>
                    <MyInput id="trk-number" input={form.tracking} onChangeFunction={set('tracking')} maxLength={64} className="sm:w-full" />
                </Field>
                <Field label={t('orders.ship.trackingLink')} htmlFor="trk-link" error={problems.link ? t(problems.link) : null}>
                    <MyInput id="trk-link" inputType="url" input={form.link} onChangeFunction={set('link')} maxLength={500} className="sm:w-full" />
                </Field>
                <OrderErrorAlert error={write.error} currency={detail.order.currency} />
            </div>
        </MyDialog>
    );
}
