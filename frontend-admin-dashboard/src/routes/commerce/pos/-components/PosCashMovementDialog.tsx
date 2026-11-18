import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { cn } from '@/lib/utils';
import { useRequestId } from '@/routes/commerce/orders/-shared/request-id';
import { useCashMovement } from '../-shared/pos-hooks';
import { PosErrorNotice, PosField, isAmount, posInputClass, rupees, sanitizeAmount } from './pos-ui';

/**
 * Cash in / cash out of the drawer (manager only, contract §3.8). A correction
 * is an opposite movement; nothing here cancels one.
 */
export function PosCashMovementDialog({
    sessionId,
    open,
    onOpenChange,
}: {
    sessionId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { t } = useTranslation('commerce');
    const [type, setType] = useState<'CASH_IN' | 'CASH_OUT'>('CASH_IN');
    const [amount, setAmount] = useState('');
    const [reason, setReason] = useState('');
    const [error, setError] = useState<unknown>(null);
    const [touched, setTouched] = useState(false);
    const { idFor, reset } = useRequestId('poscash');
    const write = useCashMovement();

    useEffect(() => {
        if (!open) return;
        setType('CASH_IN');
        setAmount('');
        setReason('');
        setError(null);
        setTouched(false);
        reset();
    }, [open, reset]);

    const amountOk = isAmount(amount);
    const reasonOk = reason.trim().length > 0 && reason.trim().length <= 200;

    const save = async () => {
        setTouched(true);
        if (!amountOk || !reasonOk) return;
        const body = { type, amount: Number(amount).toFixed(2), reason: reason.trim() };
        setError(null);
        try {
            await write.mutateAsync([sessionId, { ...body, client_request_id: idFor(body) }]);
            toast.success(t('pos.cash.saved', { amount: rupees(body.amount) }));
            onOpenChange(false);
        } catch (e) {
            setError(e);
        }
    };

    return (
        <MyDialog
            heading={t('pos.cash.heading')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-md"
            footer={
                <div className="flex w-full justify-end gap-2">
                    <MyButton type="button" buttonType="secondary" scale="large" className="h-12" onClick={() => onOpenChange(false)}>
                        {t('common.cancel')}
                    </MyButton>
                    <MyButton type="button" buttonType="primary" scale="large" className="h-12" onAsyncClick={save}>
                        {t('common.save')}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-4">
                <div role="radiogroup" aria-label={t('pos.cash.heading')} className="grid grid-cols-2 gap-2">
                    {(['CASH_IN', 'CASH_OUT'] as const).map((value) => (
                        <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={type === value}
                            onClick={() => setType(value)}
                            className={cn(
                                'min-h-12 rounded-md border text-subtitle',
                                type === value
                                    ? 'border-primary-500 bg-primary-50 text-primary-500'
                                    : 'border-neutral-300 text-neutral-600'
                            )}
                        >
                            {value === 'CASH_IN' ? t('pos.cash.in') : t('pos.cash.out')}
                        </button>
                    ))}
                </div>
                <PosField
                    label={t('pos.cash.amount')}
                    htmlFor="pos-cash-amount"
                    required
                    error={touched && !amountOk ? t('pos.validation.amount') : null}
                >
                    <input
                        id="pos-cash-amount"
                        inputMode="decimal"
                        className={posInputClass}
                        value={amount}
                        onChange={(event) => setAmount(sanitizeAmount(event.target.value))}
                    />
                </PosField>
                <PosField
                    label={t('pos.cash.reason')}
                    htmlFor="pos-cash-reason"
                    required
                    error={touched && !reasonOk ? t('pos.validation.reason') : null}
                >
                    <input
                        id="pos-cash-reason"
                        maxLength={200}
                        className={posInputClass}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                    />
                </PosField>
                <PosErrorNotice error={error} />
            </div>
        </MyDialog>
    );
}
