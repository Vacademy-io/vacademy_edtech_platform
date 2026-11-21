import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import { PlainSelect } from '@/routes/commerce/-components/CatalogueBits';
import { recordReceipt } from '@/routes/commerce/orders/-shared/order-api';
import { todayIso } from '@/routes/commerce/orders/-shared/order-format';
import { TENDER_MODES, type ReceiptBody, type TenderMode } from '@/routes/commerce/orders/-shared/order-types';
import { amountProblem, receiptDue } from '@/routes/commerce/orders/-shared/refund-cap';
import { DialogButtons, Field, OrderErrorAlert, inputClass, money } from '../order-ui';
import type { OrderDialogProps } from './dialog-types';
import { useDialogWrite } from './use-dialog-write';

const REFERENCE_MODES: ReadonlySet<TenderMode> = new Set(['UPI', 'BANK_TRANSFER', 'CHEQUE']);

/** A payment the customer made towards what the order still owes (contract §5.9). */
export function ReceiptDialog({ open, onOpenChange, detail }: OrderDialogProps) {
    const { t } = useTranslation('commerce');
    const order = detail.order;
    const due = receiptDue(detail);
    const today = todayIso();
    const [mode, setMode] = useState<TenderMode>('CASH');
    const [amount, setAmount] = useState('');
    const [reference, setReference] = useState('');
    const [date, setDate] = useState(today);
    const [touched, setTouched] = useState(false);
    const write = useDialogWrite((body: ReceiptBody) => recordReceipt(order.id, body), {
        open,
        onOpenChange,
        currency: order.currency,
        prefix: 'rcp',
    });
    useEffect(() => {
        if (!open) return;
        setMode('CASH');
        setAmount(due > 0 ? String(due) : '');
        setReference('');
        setDate(todayIso());
        setTouched(false);
    }, [open, due]);

    const value = amount.trim() === '' ? null : Number(amount);
    const problem = amountProblem(value, due);
    const amountError =
        problem === 'aboveCap'
            ? t('orders.errors.RECEIPT_ABOVE_DUE', { amount: money(due, order.currency) })
            : problem
              ? t('orders.dialogs.amountPositive')
              : null;
    const dateError = !date || date > today ? t('orders.dialogs.dateNotAfterToday') : null;

    const submit = async () => {
        setTouched(true);
        if (problem || dateError || value === null) return;
        const done = await write.submit({
            mode,
            amount: value,
            ...(reference.trim() ? { reference: reference.trim() } : {}),
            received_on: date,
        });
        if (done) {
            toast.success(t('orders.dialogs.receipt.done', { amount: money(value, order.currency) }));
            write.close();
        }
    };

    return (
        <MyDialog
            heading={t('orders.actions.RECORD_RECEIPT')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-md"
            footer={
                <DialogButtons onCancel={() => onOpenChange(false)}>
                    <MyButton type="button" buttonType="primary" scale="medium" disable={due <= 0} onAsyncClick={submit}>
                        {t('orders.actions.RECORD_RECEIPT')}
                    </MyButton>
                </DialogButtons>
            }
        >
            <div className="flex flex-col gap-4">
                <p className="text-title text-foreground">{t('orders.receipt.due', { amount: money(due, order.currency) })}</p>
                <PlainSelect
                    label={t('orders.dialogs.receipt.mode')}
                    value={mode}
                    onChange={(next) => setMode(next as TenderMode)}
                    options={TENDER_MODES.map((m) => ({ value: m, label: t(`orders.tender.${m}`) }))}
                />
                <Field label={t('orders.dialogs.amount')} htmlFor="receipt-amount" required error={touched ? amountError : null}>
                    <MyInput
                        id="receipt-amount"
                        inputType="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        input={amount}
                        onChangeFunction={(event) => setAmount(event.target.value)}
                        className="sm:w-full"
                    />
                </Field>
                <Field
                    label={t('orders.dialogs.reference')}
                    htmlFor="receipt-reference"
                    hint={REFERENCE_MODES.has(mode) ? t('orders.dialogs.receipt.referenceHint') : undefined}
                >
                    <MyInput
                        id="receipt-reference"
                        input={reference}
                        maxLength={100}
                        onChangeFunction={(event) => setReference(event.target.value)}
                        className="sm:w-full"
                    />
                </Field>
                <Field label={t('orders.dialogs.receipt.receivedOn')} htmlFor="receipt-date" required error={touched ? dateError : null}>
                    <input
                        id="receipt-date"
                        type="date"
                        className={inputClass}
                        value={date}
                        max={today}
                        onChange={(event) => setDate(event.target.value)}
                    />
                </Field>
                <OrderErrorAlert error={write.error} currency={order.currency} />
            </div>
        </MyDialog>
    );
}
