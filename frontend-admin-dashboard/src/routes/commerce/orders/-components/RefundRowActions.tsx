import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { cancelRefund, checkRefund, recordRefundPayout } from '@/routes/commerce/orders/-shared/order-api';
import { todayIso } from '@/routes/commerce/orders/-shared/order-format';
import type { RefundSummary, RefundView } from '@/routes/commerce/orders/-shared/order-types';
import { useAnswerWrite } from './dialogs/use-answer-write';
import { DialogButtons, Field, OrderErrorAlert, TextAreaField, inputClass } from './order-ui';

type RowAction = 'PAYOUT' | 'CANCEL' | 'CHECK';

const PAYOUT_METHODS: ReadonlySet<string> = new Set(['BANK_TRANSFER', 'UPI']);

/** Which follow-up steps a refund offers (contract §5.7.3). */
export function refundRowActions(refund: Pick<RefundSummary, 'status' | 'method'>): RowAction[] {
    const status = (refund.status ?? '').toUpperCase();
    const method = (refund.method ?? '').toUpperCase();
    const out: RowAction[] = [];
    if (status === 'PENDING' && PAYOUT_METHODS.has(method)) out.push('PAYOUT');
    if (status === 'PENDING') out.push('CANCEL');
    if (status === 'IN_PROGRESS' && method === 'GATEWAY') out.push('CHECK');
    return out;
}

/**
 * A refund row's buttons (manager, institute admin): record the payout of a
 * "pay later" UPI or bank refund, cancel a pending one, or ask the gateway again.
 */
export function RefundRowActions({ refund, currency }: { refund: RefundSummary; currency: string }) {
    const { t } = useTranslation('commerce');
    const access = useCommerceAccess();
    const [open, setOpen] = useState<RowAction | null>(null);
    const actions = refundRowActions(refund);
    const check = useAnswerWrite(
        (body: { client_request_id: string }) => checkRefund(refund.id, body),
        { open: true, onOpenChange: () => undefined, currency, prefix: 'rfc' }
    );
    if (!access.isResolved || !access.isManager || actions.length === 0) return null;

    const runCheck = async () => {
        const answer: RefundView | null = await check.submit({});
        if (answer) toast.success(t('orders.refunds.checked', { status: t(`status.refund.${answer.status ?? 'PENDING'}`) }));
    };

    return (
        <div className="flex flex-wrap items-center gap-2">
            {actions.includes('PAYOUT') && (
                <MyButton type="button" buttonType="secondary" scale="small" onClick={() => setOpen('PAYOUT')}>
                    {t('orders.refunds.recordPayout')}
                </MyButton>
            )}
            {actions.includes('CANCEL') && (
                <MyButton type="button" buttonType="secondary" scale="small" onClick={() => setOpen('CANCEL')}>
                    {t('orders.refunds.cancel')}
                </MyButton>
            )}
            {actions.includes('CHECK') && (
                <MyButton type="button" buttonType="secondary" scale="small" onAsyncClick={runCheck}>
                    {t('orders.refunds.check')}
                </MyButton>
            )}
            {check.error && (
                <div className="w-full">
                    <OrderErrorAlert error={check.error} currency={currency} />
                </div>
            )}
            {open === 'PAYOUT' && (
                <PayoutDialog refund={refund} currency={currency} onClose={() => setOpen(null)} />
            )}
            {open === 'CANCEL' && (
                <CancelRefundDialog refund={refund} currency={currency} onClose={() => setOpen(null)} />
            )}
        </div>
    );
}

function PayoutDialog({ refund, currency, onClose }: { refund: RefundSummary; currency: string; onClose: () => void }) {
    const { t } = useTranslation('commerce');
    const today = todayIso();
    const [reference, setReference] = useState('');
    const [paidOn, setPaidOn] = useState(today);
    const [touched, setTouched] = useState(false);
    const onOpenChange = (next: boolean) => {
        if (!next) onClose();
    };
    const write = useAnswerWrite(
        (body: { client_request_id: string; reference: string; paid_on?: string }) =>
            recordRefundPayout(refund.id, body),
        { open: true, onOpenChange, currency, prefix: 'rfp' }
    );
    const referenceError = !reference.trim() ? t('orders.refunds.referenceRequired') : null;
    const dateError = !paidOn || paidOn > today ? t('orders.dialogs.dateNotAfterToday') : null;
    const submit = async () => {
        setTouched(true);
        if (referenceError || dateError) return;
        const answer = await write.submit({ reference: reference.trim(), paid_on: paidOn });
        if (answer) {
            toast.success(t('orders.refunds.payoutDone'));
            write.close();
        }
    };
    return (
        <MyDialog
            heading={t('orders.refunds.recordPayout')}
            open
            onOpenChange={onOpenChange}
            dialogWidth="max-w-md"
            footer={
                <DialogButtons onCancel={onClose}>
                    <MyButton type="button" buttonType="primary" scale="medium" onAsyncClick={submit}>
                        {t('orders.refunds.recordPayout')}
                    </MyButton>
                </DialogButtons>
            }
        >
            <div className="flex flex-col gap-4">
                <Field label={t('orders.dialogs.reference')} htmlFor="payout-reference" required error={touched ? referenceError : null}>
                    <MyInput
                        id="payout-reference"
                        input={reference}
                        maxLength={100}
                        onChangeFunction={(event) => setReference(event.target.value)}
                        className="sm:w-full"
                    />
                </Field>
                <Field label={t('orders.refund.paidOn')} htmlFor="payout-paid-on" required error={touched ? dateError : null}>
                    <input
                        id="payout-paid-on"
                        type="date"
                        className={inputClass}
                        value={paidOn}
                        max={today}
                        onChange={(event) => setPaidOn(event.target.value)}
                    />
                </Field>
                <OrderErrorAlert error={write.error} currency={currency} />
            </div>
        </MyDialog>
    );
}

function CancelRefundDialog({ refund, currency, onClose }: { refund: RefundSummary; currency: string; onClose: () => void }) {
    const { t } = useTranslation('commerce');
    const [reason, setReason] = useState('');
    const [touched, setTouched] = useState(false);
    const onOpenChange = (next: boolean) => {
        if (!next) onClose();
    };
    const write = useAnswerWrite(
        (body: { client_request_id: string; reason: string }) => cancelRefund(refund.id, body),
        { open: true, onOpenChange, currency, prefix: 'rfx' }
    );
    const reasonError = !reason.trim() ? t('orders.dialogs.reasonRequired') : null;
    const submit = async () => {
        setTouched(true);
        if (reasonError) return;
        const answer = await write.submit({ reason: reason.trim() });
        if (answer) {
            toast.success(t('orders.refunds.cancelled'));
            write.close();
        }
    };
    return (
        <MyDialog
            heading={t('orders.refunds.cancel')}
            open
            onOpenChange={onOpenChange}
            dialogWidth="max-w-md"
            footer={
                <DialogButtons onCancel={onClose}>
                    <MyButton type="button" buttonType="primary" scale="medium" onAsyncClick={submit}>
                        {t('orders.refunds.cancel')}
                    </MyButton>
                </DialogButtons>
            }
        >
            <div className="flex flex-col gap-4">
                <TextAreaField
                    id="refund-cancel-reason"
                    label={t('orders.reason')}
                    value={reason}
                    onChange={setReason}
                    required
                    maxLength={500}
                    error={touched ? reasonError : null}
                />
                <OrderErrorAlert error={write.error} currency={currency} />
            </div>
        </MyDialog>
    );
}
