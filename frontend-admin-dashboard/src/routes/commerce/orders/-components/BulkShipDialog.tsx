import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UploadSimple } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import {
    readBulkShipCsvFile,
    shownProblems,
    type BulkShipCsvResult,
} from '@/routes/commerce/orders/-shared/bulk-ship-csv';
import { readCouriers, rememberCourier } from '@/routes/commerce/orders/-shared/courier-memory';
import type { BulkItem, StaffOrderRow } from '@/routes/commerce/orders/-shared/order-types';
import { TRACKING_PATTERN } from './dialogs/ShipDialog';
import { DialogButtons, Field, OrderErrorAlert, OrderNotice } from './order-ui';
import type { OrderError } from '@/routes/commerce/orders/-shared/order-errors';

interface ShipRow {
    courier: string;
    tracking: string;
    link: string;
}

const LINK_PATTERN = /^https:\/\/\S+$/;

/** A row is ready when it has a courier and a valid tracking number (link optional, https). */
export const shipRowReady = (row: ShipRow): boolean =>
    row.courier.trim().length > 0 &&
    row.courier.trim().length <= 100 &&
    row.tracking.trim().length > 0 &&
    row.tracking.trim().length <= 64 &&
    TRACKING_PATTERN.test(row.tracking.trim()) &&
    (!row.link.trim() || (LINK_PATTERN.test(row.link.trim()) && row.link.trim().length <= 500));

/**
 * "Mark shipped" for the ticked packed orders: one courier for all (editable
 * per row) and a tracking number per order, typed or filled from the courier's
 * CSV. Rows the CSV cannot fill are listed by line.
 */
export function BulkShipDialog({
    rows,
    open,
    onOpenChange,
    onSubmit,
    error,
}: {
    rows: StaffOrderRow[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (items: BulkItem[]) => Promise<void>;
    error: OrderError | null;
}) {
    const { t } = useTranslation('commerce');
    const couriers = useMemo(() => (open ? readCouriers() : []), [open]);
    const [courierAll, setCourierAll] = useState('');
    const [values, setValues] = useState<Record<string, ShipRow>>({});
    const [csv, setCsv] = useState<BulkShipCsvResult | null>(null);
    const [tried, setTried] = useState(false);
    const fileRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (!open) return;
        const first = readCouriers()[0] ?? '';
        setCourierAll(first);
        setValues(Object.fromEntries(rows.map((row) => [row.id, { courier: first, tracking: '', link: '' }])));
        setCsv(null);
        setTried(false);
    }, [open, rows]);

    const rowOf = (id: string): ShipRow => values[id] ?? { courier: courierAll, tracking: '', link: '' };
    const setRow = (id: string, change: Partial<ShipRow>) =>
        setValues((current) => ({ ...current, [id]: { ...rowOf(id), ...change } }));

    const applyAll = () =>
        setValues((current) =>
            Object.fromEntries(rows.map((row) => [row.id, { ...(current[row.id] ?? rowOf(row.id)), courier: courierAll }]))
        );

    const readFile = async (file: File) => {
        const result = await readBulkShipCsvFile(
            file,
            rows.map((row) => ({ order_id: row.id, order_number: row.order_number }))
        );
        setCsv(result);
        setValues((current) => {
            const next = { ...current };
            result.items.forEach((item) => {
                next[item.order_id] = {
                    courier: item.carrier_name,
                    tracking: item.tracking_number,
                    link: item.tracking_url ?? '',
                };
            });
            return next;
        });
    };

    const problems = csv && csv.errors.length > 0 ? shownProblems(csv.errors) : null;

    const allReady = rows.length > 0 && rows.every((row) => shipRowReady(rowOf(row.id)));

    const submit = async () => {
        setTried(true);
        if (!allReady) return;
        const items: BulkItem[] = rows.map((row) => {
            const value = rowOf(row.id);
            return {
                order_id: row.id,
                from_status: 'PACKED',
                carrier_name: value.courier.trim(),
                tracking_number: value.tracking.trim(),
                ...(value.link.trim() ? { tracking_url: value.link.trim() } : {}),
            };
        });
        await onSubmit(items);
        new Set(items.map((item) => item.carrier_name ?? '')).forEach((name) => rememberCourier(name));
    };

    return (
        <MyDialog
            heading={t('orders.bulkShip.title')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-3xl"
            footer={
                <DialogButtons onCancel={() => onOpenChange(false)}>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        onAsyncClick={submit}
                        loadingText={t('common.saving')}
                    >
                        {t('orders.bulk.markShipped')}
                    </MyButton>
                </DialogButtons>
            }
        >
            <div className="flex flex-col gap-4">
                <datalist id="bulk-ship-couriers">
                    {couriers.map((name) => (
                        <option key={name} value={name} />
                    ))}
                </datalist>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <Field label={t('orders.bulkShip.courierAll')} htmlFor="bulk-ship-courier" className="flex-1">
                        <MyInput
                            id="bulk-ship-courier"
                            input={courierAll}
                            list="bulk-ship-couriers"
                            maxLength={100}
                            onChangeFunction={(event) => setCourierAll(event.target.value)}
                            className="sm:w-full"
                        />
                    </Field>
                    <MyButton type="button" buttonType="secondary" scale="medium" onClick={applyAll}>
                        {t('orders.bulkShip.applyAll')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => fileRef.current?.click()}
                    >
                        <UploadSimple size={16} />
                        {t('orders.bulkShip.uploadCsv')}
                    </MyButton>
                    <input
                        ref={fileRef}
                        type="file"
                        accept=".csv,text/csv"
                        className="hidden"
                        aria-label={t('orders.bulkShip.uploadCsv')}
                        onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void readFile(file);
                            event.target.value = '';
                        }}
                    />
                </div>
                <p className="text-caption text-muted-foreground">{t('orders.bulkShip.csvHelp')}</p>
                {csv && csv.items.length > 0 && (
                    <OrderNotice tone="success">{t('orders.bulkShip.csvFilled', { count: csv.items.length })}</OrderNotice>
                )}
                {problems && (
                    <OrderNotice tone="warning">
                        <ul className="flex flex-col gap-0.5" data-testid="bulk-ship-csv-problems">
                            {problems.shown.map((problem) => (
                                <li key={`${problem.line}-${problem.key}`}>
                                    {t(`orders.bulkShip.csvErrors.${problem.key}`, {
                                        line: problem.line,
                                        value: problem.value ?? '',
                                    })}
                                </li>
                            ))}
                            {problems.more > 0 && (
                                <li>{t('orders.bulkShip.csvMore', { count: problems.more })}</li>
                            )}
                        </ul>
                    </OrderNotice>
                )}
                <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                    {rows.map((row) => {
                        const value = rowOf(row.id);
                        const bad = tried && !shipRowReady(value);
                        return (
                            <li key={row.id} className="grid grid-cols-1 gap-2 p-3 md:grid-cols-4">
                                <div className="flex flex-col">
                                    <span className="text-body font-medium text-foreground">{row.order_number}</span>
                                    <span className="text-caption text-muted-foreground">{row.customer_name ?? ''}</span>
                                </div>
                                <MyInput
                                    input={value.courier}
                                    list="bulk-ship-couriers"
                                    maxLength={100}
                                    aria-label={`${t('orders.ship.courier')} ${row.order_number}`}
                                    inputPlaceholder={t('orders.ship.courier')}
                                    onChangeFunction={(event) => setRow(row.id, { courier: event.target.value })}
                                    error={bad && !value.courier.trim() ? t('orders.bulkShip.missing') : null}
                                    className="sm:w-full"
                                />
                                <MyInput
                                    input={value.tracking}
                                    maxLength={64}
                                    aria-label={`${t('orders.ship.trackingNumber')} ${row.order_number}`}
                                    inputPlaceholder={t('orders.ship.trackingNumber')}
                                    onChangeFunction={(event) => setRow(row.id, { tracking: event.target.value })}
                                    error={bad && !TRACKING_PATTERN.test(value.tracking.trim()) ? t('orders.bulkShip.missing') : null}
                                    className="sm:w-full"
                                />
                                <MyInput
                                    input={value.link}
                                    inputType="url"
                                    maxLength={500}
                                    aria-label={`${t('orders.ship.trackingLink')} ${row.order_number}`}
                                    inputPlaceholder={t('orders.ship.trackingLink')}
                                    onChangeFunction={(event) => setRow(row.id, { link: event.target.value })}
                                    className="sm:w-full"
                                />
                            </li>
                        );
                    })}
                </ul>
                {tried && !allReady && <OrderNotice tone="danger">{t('orders.bulkShip.missing')}</OrderNotice>}
                <OrderErrorAlert error={error} />
            </div>
        </MyDialog>
    );
}
