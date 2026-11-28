import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyPagination } from '@/components/design-system/pagination';
import { Checkbox } from '@/components/ui/checkbox';
import { formatDate } from '@/lib/formatters';
import {
    CommerceEmptyState,
    CommerceErrorState,
    CommerceLoadingRows,
} from '@/routes/commerce/-components/CommerceStates';
import { readCouriers, rememberCourier } from '@/routes/commerce/orders/-shared/courier-memory';
import { fetchOrders } from '@/routes/commerce/orders/-shared/order-api';
import { type OrderError, readOrderError } from '@/routes/commerce/orders/-shared/order-errors';
import { codToCollect, round2, todayIso } from '@/routes/commerce/orders/-shared/order-format';
import { orderKeys, useRecordRemittance } from '@/routes/commerce/orders/-shared/order-hooks';
import type { StaffOrderRow } from '@/routes/commerce/orders/-shared/order-types';
import { useRequestId } from '@/routes/commerce/orders/-shared/request-id';
import {
    DialogButtons,
    Field,
    OrderErrorAlert,
    TextAreaField,
    inputClass,
    money,
    useOrderErrorHandler,
    useOrderErrorText,
} from '../order-ui';

/**
 * Record COD remittance (contract §5.6.2): the courier pays the shop the cash it
 * collected on delivery for a set of orders, minus its deductions. The ticked
 * orders become paid. Opened from the COD queue's bulk bar, the order detail
 * and the remittances page.
 */

const PICKER_PAGE_SIZE = 50;
const MAX_ORDERS = 500;

export interface RemittanceDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Orders ticked when the dialog opens. */
    initialOrders?: StaffOrderRow[];
}

const parseAmount = (text: string): number | null => {
    if (text.trim() === '') return null;
    const value = Number(text);
    return Number.isFinite(value) ? value : null;
};

export function RemittanceDialog({ open, onOpenChange, initialOrders }: RemittanceDialogProps) {
    const { t } = useTranslation('commerce');
    const handleError = useOrderErrorHandler();
    const errorText = useOrderErrorText();
    const mutation = useRecordRemittance();
    const { idFor, reset } = useRequestId('r');

    const [reference, setReference] = useState('');
    const [courier, setCourier] = useState('');
    const [receivedOn, setReceivedOn] = useState(todayIso());
    const [ticked, setTicked] = useState<Map<string, StaffOrderRow>>(new Map());
    const [gross, setGross] = useState('');
    const [grossEdited, setGrossEdited] = useState(false);
    const [deductions, setDeductions] = useState('0');
    const [differenceReason, setDifferenceReason] = useState('');
    const [note, setNote] = useState('');
    const [page, setPage] = useState(0);
    const [showErrors, setShowErrors] = useState(false);
    const [error, setError] = useState<OrderError | null>(null);

    // A fresh form each time the dialog opens, with the given orders ticked.
    useEffect(() => {
        if (!open) {
            reset();
            return;
        }
        setReference('');
        setCourier('');
        setReceivedOn(todayIso());
        setTicked(new Map((initialOrders ?? []).map((row) => [row.id, row])));
        setGross('');
        setGrossEdited(false);
        setDeductions('0');
        setDifferenceReason('');
        setNote('');
        setPage(0);
        setShowErrors(false);
        setError(null);
        // initialOrders is read when the dialog opens only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, reset]);

    const picker = useQuery({
        queryKey: [...orderKeys.all(), 'remittance-picker', page],
        queryFn: () => fetchOrders({ queue: 'COD_TO_COLLECT', page, pageSize: PICKER_PAGE_SIZE }),
        enabled: open,
        staleTime: 30 * 1000,
        placeholderData: (previous) => previous,
    });

    const couriers = useMemo(() => (open ? readCouriers() : []), [open]);
    const tickedRows = Array.from(ticked.values());
    const currency = tickedRows[0]?.currency ?? 'INR';
    const sum = round2(tickedRows.reduce((total, row) => total + codToCollect(row), 0));

    // Gross follows the ticked orders until someone types it.
    useEffect(() => {
        if (!grossEdited) setGross(tickedRows.length > 0 ? sum.toFixed(2) : '');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sum, grossEdited]);

    const grossValue = parseAmount(gross);
    const deductionsValue = parseAmount(deductions);
    const net = grossValue !== null && deductionsValue !== null ? round2(grossValue - deductionsValue) : null;
    const differs = grossValue !== null && tickedRows.length > 0 && round2(grossValue) !== sum;
    const today = todayIso();

    const problems = {
        reference: !reference.trim() ? t('orders.remittance.errors.referenceRequired') : null,
        receivedOn: !receivedOn
            ? t('orders.remittance.errors.receivedOnRequired')
            : receivedOn > today
              ? t('orders.remittance.errors.receivedOnFuture')
              : null,
        orders:
            tickedRows.length === 0
                ? t('orders.remittance.errors.noOrders')
                : tickedRows.length > MAX_ORDERS
                  ? t('orders.remittance.errors.tooMany', { max: MAX_ORDERS })
                  : null,
        gross: grossValue === null || grossValue <= 0 ? t('orders.remittance.errors.grossPositive') : null,
        deductions:
            deductionsValue === null || deductionsValue < 0
                ? t('orders.remittance.errors.deductionsInvalid')
                : net !== null && net < 0
                  ? t('orders.remittance.errors.netNegative')
                  : null,
        differenceReason:
            differs && !differenceReason.trim() ? t('orders.remittance.errors.differenceReasonRequired') : null,
    };
    const valid = Object.values(problems).every((problem) => problem === null);
    const shown = (key: keyof typeof problems) => (showErrors ? problems[key] : null);

    const toggle = (row: StaffOrderRow, on: boolean) =>
        setTicked((current) => {
            const next = new Map(current);
            if (on) next.set(row.id, row);
            else next.delete(row.id);
            return next;
        });

    const pageRows = picker.data?.orders ?? [];
    const allOnPage = pageRows.length > 0 && pageRows.every((row) => ticked.has(row.id));

    const submit = async () => {
        setShowErrors(true);
        setError(null);
        if (!valid || grossValue === null || deductionsValue === null || net === null) return;
        const payload = {
            reference: reference.trim(),
            ...(courier.trim() ? { courier_name: courier.trim() } : {}),
            received_on: receivedOn,
            gross_amount: round2(grossValue),
            deductions: round2(deductionsValue),
            net_amount: net,
            ...(differs ? { difference_reason: differenceReason.trim() } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
            order_ids: tickedRows.map((row) => row.id),
        };
        try {
            const saved = await mutation.mutateAsync({ ...payload, client_request_id: idFor(payload) });
            if (courier.trim()) rememberCourier(courier);
            toast.success(
                t('orders.remittance.recorded', { count: saved.order_count ?? payload.order_ids.length })
            );
            reset();
            onOpenChange(false);
        } catch (raw) {
            setError(handleError(raw, { close: () => onOpenChange(false), resetRequestId: reset, currency }));
        }
    };

    return (
        <MyDialog
            heading={t('orders.actions.RECORD_REMITTANCE')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-3xl"
            footer={
                <DialogButtons onCancel={() => onOpenChange(false)}>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disable={mutation.isPending}
                        onAsyncClick={submit}
                        loadingText={t('common.saving')}
                    >
                        {t('orders.remittance.save')}
                    </MyButton>
                </DialogButtons>
            }
        >
            <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field
                        label={t('orders.remittance.reference')}
                        htmlFor="remit-reference"
                        hint={t('orders.remittance.referenceHint')}
                        error={shown('reference')}
                        required
                    >
                        <input
                            id="remit-reference"
                            className={inputClass}
                            value={reference}
                            maxLength={100}
                            onChange={(event) => setReference(event.target.value)}
                        />
                    </Field>
                    <Field label={t('orders.ship.courier')} htmlFor="remit-courier" hint={t('orders.optional')}>
                        <input
                            id="remit-courier"
                            className={inputClass}
                            value={courier}
                            maxLength={100}
                            list="remit-couriers"
                            onChange={(event) => setCourier(event.target.value)}
                        />
                        <datalist id="remit-couriers">
                            {couriers.map((name) => (
                                <option key={name} value={name} />
                            ))}
                        </datalist>
                    </Field>
                    <Field
                        label={t('orders.remittance.receivedOn')}
                        htmlFor="remit-received-on"
                        error={shown('receivedOn')}
                        required
                    >
                        <input
                            id="remit-received-on"
                            type="date"
                            className={inputClass}
                            value={receivedOn}
                            max={today}
                            onChange={(event) => setReceivedOn(event.target.value)}
                        />
                    </Field>
                </div>

                <section className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h3 className="text-subtitle font-medium text-foreground">
                            {t('orders.remittance.orders')}
                        </h3>
                        <span className="text-caption text-muted-foreground">
                            {t('orders.remittance.tickedSum', {
                                count: tickedRows.length,
                                amount: money(sum, currency),
                            })}
                        </span>
                    </div>
                    {shown('orders') && (
                        <p role="alert" className="text-caption text-danger-600">
                            {shown('orders')}
                        </p>
                    )}
                    {picker.isLoading && <CommerceLoadingRows rows={3} />}
                    {picker.isError && (
                        <CommerceErrorState
                            message={errorText(readOrderError(picker.error))}
                            onRetry={() => void picker.refetch()}
                        />
                    )}
                    {picker.isSuccess && pageRows.length === 0 && (
                        <CommerceEmptyState title={t('orders.empty.COD_TO_COLLECT')} />
                    )}
                    {pageRows.length > 0 && (
                        <ul className="flex max-h-64 flex-col divide-y divide-border overflow-y-auto rounded-lg border border-border">
                            <li className="flex items-center gap-3 p-3 text-caption text-muted-foreground">
                                <Checkbox
                                    id="remit-all"
                                    checked={allOnPage}
                                    onCheckedChange={(checked) =>
                                        pageRows.forEach((row) => toggle(row, checked === true))
                                    }
                                />
                                <label htmlFor="remit-all">{t('orders.list.selectAll')}</label>
                            </li>
                            {pageRows.map((row) => {
                                const id = `remit-order-${row.id}`;
                                return (
                                    <li key={row.id} className="flex items-center gap-3 p-3">
                                        <Checkbox
                                            id={id}
                                            checked={ticked.has(row.id)}
                                            onCheckedChange={(checked) => toggle(row, checked === true)}
                                        />
                                        <label htmlFor={id} className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">
                                            <span className="flex min-w-0 flex-col">
                                                <span className="text-body font-medium text-foreground">
                                                    {row.order_number}
                                                </span>
                                                <span className="truncate text-caption text-muted-foreground">
                                                    {[row.customer_name, row.created_at ? formatDate(row.created_at) : null]
                                                        .filter(Boolean)
                                                        .join(' · ')}
                                                </span>
                                            </span>
                                            <span className="text-body tabular-nums text-foreground">
                                                {money(codToCollect(row), row.currency)}
                                            </span>
                                        </label>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                    {(picker.data?.total ?? 0) > PICKER_PAGE_SIZE && (
                        <MyPagination
                            currentPage={page}
                            totalPages={Math.ceil((picker.data?.total ?? 0) / PICKER_PAGE_SIZE)}
                            onPageChange={setPage}
                            compactOnPhone
                        />
                    )}
                </section>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field
                        label={t('orders.remittance.gross')}
                        htmlFor="remit-gross"
                        error={shown('gross')}
                        required
                    >
                        <input
                            id="remit-gross"
                            type="number"
                            inputMode="decimal"
                            min={0}
                            step="0.01"
                            className={`${inputClass} text-end`}
                            value={gross}
                            onChange={(event) => {
                                setGrossEdited(true);
                                setGross(event.target.value);
                            }}
                        />
                    </Field>
                    <Field
                        label={t('orders.remittance.deductions')}
                        htmlFor="remit-deductions"
                        error={shown('deductions')}
                        required
                    >
                        <input
                            id="remit-deductions"
                            type="number"
                            inputMode="decimal"
                            min={0}
                            step="0.01"
                            className={`${inputClass} text-end`}
                            value={deductions}
                            onChange={(event) => setDeductions(event.target.value)}
                        />
                    </Field>
                    <Field label={t('orders.remittance.net')}>
                        <output
                            aria-live="polite"
                            className="flex h-12 items-center justify-end rounded-md bg-muted px-3 text-body font-medium tabular-nums text-foreground md:h-9"
                        >
                            {net !== null ? money(net, currency) : '—'}
                        </output>
                    </Field>
                </div>

                {differs && (
                    <TextAreaField
                        id="remit-difference"
                        label={t('orders.remittance.differenceReason')}
                        value={differenceReason}
                        onChange={setDifferenceReason}
                        required
                        error={shown('differenceReason')}
                        hint={t('orders.remittance.differenceHint', { amount: money(sum, currency) })}
                    />
                )}
                <TextAreaField
                    id="remit-note"
                    label={t('orders.note')}
                    value={note}
                    onChange={setNote}
                    hint={t('orders.optional')}
                />
                <OrderErrorAlert error={error} currency={currency} />
            </div>
        </MyDialog>
    );
}
