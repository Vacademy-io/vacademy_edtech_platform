import { useEffect, useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import { PlainSelect } from '@/routes/commerce/-components/CatalogueBits';
import { exchangeableReturn } from '@/routes/commerce/orders/-shared/order-actions';
import { createRefund, fetchReturn } from '@/routes/commerce/orders/-shared/order-api';
import { todayIso } from '@/routes/commerce/orders/-shared/order-format';
import { orderKeys } from '@/routes/commerce/orders/-shared/order-hooks';
import {
    REFUND_METHODS,
    type RefundBody,
    type RefundMethod,
    type RefundView,
    type ReturnView,
} from '@/routes/commerce/orders/-shared/order-types';
import { amountProblem, refundCap, refundCapText } from '@/routes/commerce/orders/-shared/refund-cap';
import { DialogButtons, Field, OrderErrorAlert, OrderNotice, TextAreaField, inputClass } from '../order-ui';
import type { OrderDialogProps } from './dialog-types';
import { useAnswerWrite } from './use-answer-write';

const PAY_LATER_METHODS: ReadonlySet<RefundMethod> = new Set(['UPI', 'BANK_TRANSFER']);
const ORDER_TARGET = '__order__';

/** The returns of the order that can still be refunded: read in full (summaries lack due_raised). */
export function useRefundableReturns(detail: OrderDialogProps['detail'], enabled: boolean) {
    const candidates = detail.returns.filter((summary) => {
        const status = (summary.status ?? '').toUpperCase();
        return status === 'RECEIVED' || status === 'CLOSED';
    });
    const queries = useQueries({
        queries: candidates.map((summary) => ({
            queryKey: orderKeys.returnView(summary.id),
            queryFn: () => fetchReturn(summary.id),
            enabled,
            staleTime: 10 * 1000,
        })),
    });
    const views = queries.map((query) => query.data).filter((view): view is ReturnView => !!view);
    return {
        views: views.filter(exchangeableReturn),
        loading: queries.some((query) => query.isLoading),
    };
}

/**
 * Refund (contract §5.7.4, manager): for the order or for a received return,
 * never more than the cap, which the dialog always states. The server's
 * REFUND_ABOVE_* answer repeats the sentence with its own amount.
 */
export function RefundDialog({ open, onOpenChange, detail, returnId }: OrderDialogProps & { returnId?: string }) {
    const { t } = useTranslation('commerce');
    const order = detail.order;
    const currency = order.currency;
    const today = todayIso();
    const refundable = useRefundableReturns(detail, open);
    const [target, setTarget] = useState<string>(returnId ?? ORDER_TARGET);
    const methods = useMemo(
        () => REFUND_METHODS.filter((method) => method !== 'GATEWAY' || !!detail.gateway_order_id),
        [detail.gateway_order_id]
    );
    const [method, setMethod] = useState<RefundMethod>(methods[0] ?? 'UPI');
    const [amount, setAmount] = useState('');
    const [reference, setReference] = useState('');
    const [paidOn, setPaidOn] = useState(today);
    const [reason, setReason] = useState('');
    const [touched, setTouched] = useState(false);

    const returnView = target === ORDER_TARGET ? null : (refundable.views.find((view) => view.id === target) ?? null);
    const forReturn = target !== ORDER_TARGET;
    // A return that is still loading, or has nothing left, caps the refund at 0.
    const cap = forReturn && !returnView ? 0 : refundCap(detail, returnView);
    const capText = refundCapText(cap, forReturn, t, currency);

    const write = useAnswerWrite((body: RefundBody) => createRefund(body), {
        open,
        onOpenChange,
        currency,
        prefix: 'rfd',
    });

    useEffect(() => {
        if (!open) return;
        setTarget(returnId ?? ORDER_TARGET);
        setMethod(methods[0] ?? 'UPI');
        setReference('');
        setPaidOn(todayIso());
        setReason('');
        setTouched(false);
    }, [open, returnId, methods]);

    // The amount starts at the cap, and follows it when the target changes.
    useEffect(() => {
        if (open) setAmount(cap > 0 ? cap.toFixed(2) : '');
    }, [open, cap]);

    const value = amount.trim() === '' ? null : Number(amount);
    const problem = amountProblem(value, cap);
    const amountError =
        problem === 'aboveCap' ? capText : problem ? t('orders.dialogs.amountPositive') : null;
    const showPaidOn = method === 'CASH' || (PAY_LATER_METHODS.has(method) && reference.trim() !== '');
    const dateError = showPaidOn && (!paidOn || paidOn > today) ? t('orders.dialogs.dateNotAfterToday') : null;
    const waitingForReturn = forReturn && !returnView && refundable.loading;

    const submit = async () => {
        setTouched(true);
        if (problem || dateError || value === null || waitingForReturn) return;
        const answer: RefundView | null = await write.submit({
            order_id: order.id,
            ...(forReturn ? { return_id: target } : {}),
            amount: value,
            method,
            ...(method !== 'GATEWAY' && reference.trim() ? { reference: reference.trim() } : {}),
            ...(showPaidOn ? { paid_on: paidOn } : {}),
            ...(reason.trim() ? { reason: reason.trim() } : {}),
        });
        if (answer) {
            toast.success(t(method === 'GATEWAY' ? 'orders.refund.doneGateway' : 'orders.refund.done'));
            write.close();
        }
    };

    const targetOptions = [
        { value: ORDER_TARGET, label: t('orders.refund.forOrder') },
        ...refundable.views.map((view) => ({
            value: view.id,
            label: t('orders.refund.forReturn', { number: view.return_number ?? view.id }),
        })),
    ];
    const nothingDue = cap <= 0 && !waitingForReturn;

    return (
        <MyDialog
            heading={t('orders.actions.REFUND')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-md"
            footer={
                <DialogButtons onCancel={() => onOpenChange(false)}>
                    {!nothingDue && (
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            disable={!!problem || waitingForReturn}
                            onAsyncClick={submit}
                        >
                            {t('orders.refund.submit')}
                        </MyButton>
                    )}
                </DialogButtons>
            }
        >
            <div className="flex flex-col gap-4">
                {targetOptions.length > 1 && (
                    <PlainSelect
                        label={t('orders.refund.for')}
                        value={target}
                        onChange={(next) => setTarget(next || ORDER_TARGET)}
                        options={targetOptions}
                    />
                )}
                {nothingDue ? (
                    <OrderNotice tone="info">{t('orders.refund.nothingDue')}</OrderNotice>
                ) : (
                    <>
                        <p className="text-title text-foreground" data-testid="refund-cap">
                            {capText}
                        </p>
                        <Field
                            label={t('orders.dialogs.amount')}
                            htmlFor="refund-amount"
                            required
                            error={problem === 'aboveCap' || touched ? amountError : null}
                        >
                            <MyInput
                                id="refund-amount"
                                inputType="number"
                                inputMode="decimal"
                                min={0}
                                step="0.01"
                                input={amount}
                                onChangeFunction={(event) => setAmount(event.target.value)}
                                className="sm:w-full"
                            />
                        </Field>
                        <PlainSelect
                            label={t('orders.refund.method')}
                            value={method}
                            onChange={(next) => setMethod((next || methods[0] || 'UPI') as RefundMethod)}
                            options={methods.map((m) => ({ value: m, label: t(`orders.refund.methods.${m}`) }))}
                        />
                        {method === 'GATEWAY' && (
                            <p className="text-caption text-muted-foreground">{t('orders.refund.gatewayHelp')}</p>
                        )}
                        {method !== 'GATEWAY' && (
                            <Field
                                label={t('orders.dialogs.reference')}
                                htmlFor="refund-reference"
                                hint={PAY_LATER_METHODS.has(method) ? t('orders.refund.payLaterHint') : undefined}
                            >
                                <MyInput
                                    id="refund-reference"
                                    input={reference}
                                    maxLength={100}
                                    onChangeFunction={(event) => setReference(event.target.value)}
                                    className="sm:w-full"
                                />
                            </Field>
                        )}
                        {showPaidOn && (
                            <Field
                                label={t('orders.refund.paidOn')}
                                htmlFor="refund-paid-on"
                                required
                                error={touched ? dateError : null}
                            >
                                <input
                                    id="refund-paid-on"
                                    type="date"
                                    className={inputClass}
                                    value={paidOn}
                                    max={today}
                                    onChange={(event) => setPaidOn(event.target.value)}
                                />
                            </Field>
                        )}
                        <TextAreaField
                            id="refund-reason"
                            label={t('orders.reason')}
                            value={reason}
                            onChange={setReason}
                            maxLength={500}
                        />
                    </>
                )}
                {waitingForReturn && (
                    <p className="text-caption text-muted-foreground">{t('orders.refund.loadingReturn')}</p>
                )}
                <OrderErrorAlert error={write.error} currency={currency} />
            </div>
        </MyDialog>
    );
}
