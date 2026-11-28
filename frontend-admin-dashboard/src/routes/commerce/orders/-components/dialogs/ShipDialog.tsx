import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import { Switch } from '@/components/ui/switch';
import { liveShipment } from '@/routes/commerce/orders/-shared/order-actions';
import { shipShipment } from '@/routes/commerce/orders/-shared/order-api';
import { readCouriers, rememberCourier } from '@/routes/commerce/orders/-shared/courier-memory';
import type { ShipBody } from '@/routes/commerce/orders/-shared/order-types';
import { DialogButtons, Field, OrderErrorAlert, OrderNotice } from '../order-ui';
import type { OrderDialogProps } from './dialog-types';
import { useDialogWrite } from './use-dialog-write';

export const TRACKING_PATTERN = /^[A-Za-z0-9 _/.-]+$/;
export const MAX_WEIGHT_GRAMS = 1_000_000;
/** The server flags the order stock short; the dialog closes on the reloaded order. */
const SHIP_CLOSE_CODES = ['NOT_IN_STOCK', 'PIECE_STATE'] as const;

export interface ShipForm {
    courier: string;
    tracking: string;
    link: string;
    weight: string;
}

export type ShipProblems = Partial<Record<keyof ShipForm, string>>;

/** Field checks of the Ship and Edit tracking dialogs; values are i18n keys. */
export function shipProblems(form: ShipForm, requireAll = true): ShipProblems {
    const out: ShipProblems = {};
    const courier = form.courier.trim();
    const tracking = form.tracking.trim();
    const link = form.link.trim();
    if (requireAll && !courier) out.courier = 'orders.dialogs.ship.courierRequired';
    else if (courier.length > 100) out.courier = 'orders.dialogs.ship.courierTooLong';
    if (requireAll && !tracking) out.tracking = 'orders.dialogs.ship.trackingRequired';
    else if (tracking && (tracking.length > 64 || !TRACKING_PATTERN.test(tracking))) {
        out.tracking = 'orders.dialogs.ship.trackingInvalid';
    }
    if (link && (!/^https:\/\/\S+$/i.test(link) || link.length > 500)) {
        out.link = 'orders.dialogs.ship.linkInvalid';
    }
    if (form.weight.trim()) {
        const grams = Number(form.weight);
        if (!Number.isInteger(grams) || grams < 1 || grams > MAX_WEIGHT_GRAMS) {
            out.weight = 'orders.dialogs.ship.weightInvalid';
        }
    }
    return out;
}

/** Courier, tracking number and link for the packed parcel (contract §5.4.1). */
export function ShipDialog({ open, onOpenChange, detail }: OrderDialogProps) {
    const { t } = useTranslation('commerce');
    const shipment = liveShipment(detail);
    const couriers = useMemo(() => (open ? readCouriers() : []), [open]);
    const [form, setForm] = useState<ShipForm>({ courier: '', tracking: '', link: '', weight: '' });
    const [notify, setNotify] = useState(true);
    const [touched, setTouched] = useState(false);
    const write = useDialogWrite(
        (body: ShipBody) => shipShipment(shipment?.id ?? '', body),
        { open, onOpenChange, currency: detail.order.currency, prefix: 'ship', closeOn: SHIP_CLOSE_CODES }
    );

    useEffect(() => {
        if (!open) return;
        setForm({
            courier: readCouriers()[0] ?? '',
            tracking: '',
            link: '',
            weight: shipment?.weight_grams ? String(shipment.weight_grams) : '',
        });
        setNotify(true);
        setTouched(false);
        // Prefill once per opening.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const problems = shipProblems(form);
    const shown = touched ? problems : {};
    const set = (key: keyof ShipForm) => (event: { target: { value: string } }) =>
        setForm((current) => ({ ...current, [key]: event.target.value }));

    const submit = async () => {
        setTouched(true);
        if (!shipment || Object.keys(problems).length > 0) return;
        const courier = form.courier.trim();
        const done = await write.submit({
            carrier_name: courier,
            tracking_number: form.tracking.trim(),
            ...(form.link.trim() ? { tracking_url: form.link.trim() } : {}),
            ...(form.weight.trim() ? { weight_grams: Number(form.weight) } : {}),
            notify_customer: notify,
        });
        if (done) {
            rememberCourier(courier);
            toast.success(t('orders.dialogs.ship.done'));
            write.close();
        }
    };

    return (
        <MyDialog
            heading={t('orders.dialogs.ship.title', { number: detail.order.order_number })}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-lg"
            className="h-full sm:h-auto"
            footer={
                <DialogButtons onCancel={() => onOpenChange(false)}>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disable={!shipment}
                        onAsyncClick={submit}
                    >
                        {t('orders.actions.SHIP')}
                    </MyButton>
                </DialogButtons>
            }
        >
            <div className="flex flex-col gap-4">
                {!shipment && (
                    <OrderNotice tone="warning">{t('orders.dialogs.ship.noShipment')}</OrderNotice>
                )}
                <Field label={t('orders.ship.courier')} htmlFor="ship-courier" required error={shown.courier ? t(shown.courier) : null}>
                    <MyInput
                        id="ship-courier"
                        input={form.courier}
                        onChangeFunction={set('courier')}
                        list="ship-courier-list"
                        maxLength={100}
                        className="sm:w-full"
                    />
                    <datalist id="ship-courier-list">
                        {couriers.map((name) => (
                            <option key={name} value={name} />
                        ))}
                    </datalist>
                </Field>
                <Field
                    label={t('orders.ship.trackingNumber')}
                    htmlFor="ship-tracking"
                    required
                    error={shown.tracking ? t(shown.tracking) : null}
                >
                    <MyInput
                        id="ship-tracking"
                        input={form.tracking}
                        onChangeFunction={set('tracking')}
                        maxLength={64}
                        autoCapitalize="characters"
                        className="sm:w-full"
                    />
                </Field>
                <Field
                    label={t('orders.ship.trackingLink')}
                    htmlFor="ship-link"
                    hint={t('orders.dialogs.ship.linkHint')}
                    error={shown.link ? t(shown.link) : null}
                >
                    <MyInput
                        id="ship-link"
                        inputType="url"
                        input={form.link}
                        onChangeFunction={set('link')}
                        maxLength={500}
                        inputPlaceholder="https://"
                        className="sm:w-full"
                    />
                </Field>
                <Field label={t('orders.ship.weight')} htmlFor="ship-weight" error={shown.weight ? t(shown.weight) : null}>
                    <MyInput
                        id="ship-weight"
                        inputType="number"
                        inputMode="numeric"
                        min={1}
                        max={MAX_WEIGHT_GRAMS}
                        input={form.weight}
                        onChangeFunction={set('weight')}
                        className="sm:w-full"
                    />
                </Field>
                <label className="flex min-h-12 items-center justify-between gap-3 text-body text-foreground">
                    <span className="flex flex-col">
                        {t('orders.ship.notify')}
                        <span className="text-caption text-muted-foreground">
                            {t('orders.dialogs.ship.notifyHint')}
                        </span>
                    </span>
                    <Switch checked={notify} onCheckedChange={setNotify} aria-label={t('orders.ship.notify')} />
                </label>
                <OrderErrorAlert error={write.error} currency={detail.order.currency} />
            </div>
        </MyDialog>
    );
}
