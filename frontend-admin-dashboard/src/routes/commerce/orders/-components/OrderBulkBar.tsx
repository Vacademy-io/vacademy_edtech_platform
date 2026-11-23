import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Papa from 'papaparse';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { DownloadSimple, Printer, X } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { saveBlob } from '@/lib/save-blob';
import { bulkOrders } from '@/routes/commerce/orders/-shared/order-api';
import { type OrderError, readOrderError } from '@/routes/commerce/orders/-shared/order-errors';
import { todayIso } from '@/routes/commerce/orders/-shared/order-format';
import { invalidateOrders } from '@/routes/commerce/orders/-shared/order-hooks';
import type { BulkActionId } from '@/routes/commerce/orders/-shared/order-queues';
import type { BulkAction, BulkItem, BulkResult, StaffOrderRow } from '@/routes/commerce/orders/-shared/order-types';
import { newBulkPrefix } from '@/routes/commerce/orders/-shared/request-id';
import { BulkResultsDialog } from './BulkResultsDialog';
import { BulkShipDialog } from './BulkShipDialog';
import { RemittanceDialog } from './dialogs/RemittanceDialog';
import { DialogButtons, Field, OrderErrorAlert, OrderNotice, inputClass } from './order-ui';

/** The server takes at most 100 orders a call; the desk ticks at most a page (50). */
export const BULK_MAX = 50;

const FROM_STATUS: Record<'CONFIRM' | 'PACK' | 'DELIVER', string> = {
    CONFIRM: 'COD_PENDING_CONFIRMATION',
    PACK: 'CONFIRMED',
    DELIVER: 'SHIPPED',
};

const LABEL: Record<BulkActionId, string> = {
    CONFIRM: 'orders.bulk.confirm',
    PACK: 'orders.bulk.markPacked',
    SHIP: 'orders.bulk.markShipped',
    DELIVER: 'orders.bulk.markDelivered',
    REMITTANCE: 'orders.actions.RECORD_REMITTANCE',
    PRINT: 'orders.bulk.printSlips',
    EXPORT: 'orders.bulk.export',
};

/**
 * Text cells that start with one of these get a leading apostrophe, so a spreadsheet shows
 * them as text: buyer-typed names must never run as a formula (same rule as the panel usage export).
 */
const FORMULA_START = /^[=+\-@\t\r]/;

/** Client-side CSV of rows (no server export route). */
export function ordersCsv(rows: StaffOrderRow[]): string {
    return Papa.unparse(
        rows.map((row) => ({
            order_number: row.order_number,
            placed: row.created_at ?? '',
            customer: row.customer_name ?? '',
            phone: row.customer_phone ?? '',
            total: row.total.toFixed(2),
            payment_method: row.payment_method ?? '',
            payment_status: row.payment_status ?? '',
            status: row.status,
            channel: row.channel ?? '',
            tracking: row.tracking_number ?? '',
        })),
        { escapeFormulae: FORMULA_START }
    );
}

export async function exportOrders(rows: StaffOrderRow[]): Promise<void> {
    const blob = new Blob([`﻿${ordersCsv(rows)}`], { type: 'text/csv;charset=utf-8' });
    await saveBlob(blob, `orders-${todayIso()}.csv`);
}

export const openPrintSlips = (ids: string[]) =>
    window.open(`/commerce/orders/print?ids=${ids.map(encodeURIComponent).join(',')}`, '_blank', 'noopener');

/**
 * The bar that appears when rows are ticked (current page only). It offers only
 * the actions of the tab for the role; each run shows a per-order result.
 */
export function OrderBulkBar({
    actions,
    selected,
    onClear,
    onUntickDone,
}: {
    actions: BulkActionId[];
    selected: StaffOrderRow[];
    onClear: () => void;
    onUntickDone: (ids: string[]) => void;
}) {
    const { t } = useTranslation('commerce');
    const queryClient = useQueryClient();
    const [dialog, setDialog] = useState<BulkActionId | null>(null);
    const [deliveredOn, setDeliveredOn] = useState(todayIso());
    const [error, setError] = useState<OrderError | null>(null);
    const [results, setResults] = useState<BulkResult[] | null>(null);
    const [exporting, setExporting] = useState(false);
    const prefix = useRef<string>(newBulkPrefix());
    const numbers = useRef<Record<string, string>>({});

    const open = (id: BulkActionId) => {
        if (id === 'PRINT') {
            openPrintSlips(selected.map((row) => row.id));
            return;
        }
        if (id === 'EXPORT') {
            setExporting(true);
            void exportOrders(selected)
                .catch(() => toast.error(t('orders.errors.generic')))
                .finally(() => setExporting(false));
            return;
        }
        prefix.current = newBulkPrefix();
        setError(null);
        setDeliveredOn(todayIso());
        setDialog(id);
    };

    const run = async (action: BulkAction, items: BulkItem[]) => {
        setError(null);
        numbers.current = Object.fromEntries(selected.map((row) => [row.id, row.order_number]));
        try {
            const answer = await bulkOrders({ client_request_id: prefix.current, action, items });
            setDialog(null);
            setResults(answer);
            void invalidateOrders(queryClient);
        } catch (failure) {
            const read = readOrderError(failure);
            if (read.code === 'IDEMPOTENCY_MISMATCH') prefix.current = newBulkPrefix();
            setError(read);
        }
    };

    const simpleItems = (action: 'CONFIRM' | 'PACK' | 'DELIVER'): BulkItem[] =>
        selected.map((row) => ({
            order_id: row.id,
            from_status: FROM_STATUS[action],
            ...(action === 'DELIVER' ? { delivered_on: deliveredOn } : {}),
        }));

    const simple = dialog === 'CONFIRM' || dialog === 'PACK' || dialog === 'DELIVER' ? dialog : null;
    const tooMany = selected.length > BULK_MAX;

    return (
        <>
            <div
                role="region"
                aria-label={t('orders.bulk.selected', { count: selected.length })}
                className="sticky top-0 z-10 flex flex-col gap-2 rounded-lg border border-primary-200 bg-primary-50 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
                <div className="flex items-center gap-2">
                    <span className="text-body font-medium text-foreground">
                        {t('orders.bulk.selected', { count: selected.length })}
                    </span>
                    <MyButton
                        type="button"
                        buttonType="text"
                        scale="small"
                        onClick={onClear}
                        aria-label={t('orders.bulk.clear')}
                    >
                        <X size={14} />
                        {t('orders.bulk.clear')}
                    </MyButton>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {actions.map((id) => (
                        <MyButton
                            key={id}
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            disable={tooMany || (id === 'EXPORT' && exporting)}
                            onClick={() => open(id)}
                        >
                            {id === 'PRINT' && <Printer size={16} />}
                            {id === 'EXPORT' && <DownloadSimple size={16} />}
                            {t(LABEL[id])}
                        </MyButton>
                    ))}
                </div>
            </div>

            {simple && (
                <MyDialog
                    heading={t(
                        simple === 'CONFIRM'
                            ? 'orders.bulk.confirmTitle'
                            : simple === 'PACK'
                              ? 'orders.bulk.packTitle'
                              : 'orders.bulk.deliverTitle'
                    )}
                    open
                    onOpenChange={(next) => {
                        if (!next) setDialog(null);
                    }}
                    dialogWidth="max-w-md"
                    footer={
                        <DialogButtons onCancel={() => setDialog(null)}>
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="medium"
                                disable={simple === 'DELIVER' && !deliveredOn}
                                onAsyncClick={() => run(simple, simpleItems(simple))}
                                loadingText={t('common.saving')}
                            >
                                {t('orders.bulk.run')}
                            </MyButton>
                        </DialogButtons>
                    }
                >
                    <div className="flex flex-col gap-3">
                        <p className="text-body text-foreground">
                            {t(
                                simple === 'CONFIRM'
                                    ? 'orders.bulk.confirmBody'
                                    : simple === 'PACK'
                                      ? 'orders.bulk.packBody'
                                      : 'orders.bulk.deliverBody',
                                { count: selected.length }
                            )}
                        </p>
                        {simple === 'PACK' && <OrderNotice tone="info">{t('orders.bulk.packNote')}</OrderNotice>}
                        {simple === 'DELIVER' && (
                            <Field label={t('orders.bulk.deliveredOn')} htmlFor="bulk-delivered-on" required>
                                <input
                                    id="bulk-delivered-on"
                                    type="date"
                                    className={inputClass}
                                    value={deliveredOn}
                                    max={todayIso()}
                                    onChange={(event) => setDeliveredOn(event.target.value)}
                                />
                            </Field>
                        )}
                        <OrderErrorAlert error={error} />
                    </div>
                </MyDialog>
            )}

            <BulkShipDialog
                rows={selected}
                open={dialog === 'SHIP'}
                onOpenChange={(next) => {
                    if (!next) setDialog(null);
                }}
                onSubmit={(items) => run('SHIP', items)}
                error={dialog === 'SHIP' ? error : null}
            />

            <RemittanceDialog
                open={dialog === 'REMITTANCE'}
                onOpenChange={(next) => {
                    if (!next) setDialog(null);
                }}
                initialOrders={selected}
            />

            <BulkResultsDialog
                results={results}
                numberOf={(id) => numbers.current[id] ?? id}
                onClose={() => setResults(null)}
                onUntickDone={onUntickDone}
            />
        </>
    );
}
