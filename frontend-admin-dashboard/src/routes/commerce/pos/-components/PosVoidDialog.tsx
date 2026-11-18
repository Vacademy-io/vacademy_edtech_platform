import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { OrderNotice } from '@/routes/commerce/orders/-components/order-ui';
import { useVoidSale } from '../-shared/pos-hooks';
import type { SaleAnswer, SaleDetail } from '../-shared/pos-types';
import { usePinWrite } from './PosPinGate';
import { PosErrorNotice, PosField, posInputClass, rupees } from './pos-ui';

/**
 * Void a bill of the open counter (contract §4.1): stock goes back, the bill
 * keeps its number and is marked void. A cashier needs a manager's PIN.
 */
export function PosVoidDialog({
    sale,
    registerId,
    open,
    onOpenChange,
    onDone,
}: {
    sale: SaleDetail;
    registerId: string | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDone: (answer: SaleAnswer) => void;
}) {
    const { t } = useTranslation('commerce');
    const write = useVoidSale();
    const pin = usePinWrite(registerId, 'posvoid');
    const [reason, setReason] = useState('');
    const [touched, setTouched] = useState(false);
    const [error, setError] = useState<unknown>(null);

    useEffect(() => {
        if (!open) return;
        setReason('');
        setTouched(false);
        setError(null);
    }, [open]);

    const reasonOk = reason.trim().length > 0 && reason.trim().length <= 500;
    const finish = (answer: SaleAnswer) => {
        toast.success(t('pos.void.done', { number: sale.document?.number ?? sale.order_number }));
        onDone(answer);
        onOpenChange(false);
    };

    const submit = async () => {
        setTouched(true);
        if (!reasonOk) return;
        setError(null);
        try {
            await pin.run(
                { reason: reason.trim() },
                (full) => write.mutateAsync([sale.order_id, full]),
                finish,
                `void.${sale.order_id}`
            );
        } catch (raw) {
            setError(raw);
        }
    };

    return (
        <>
            <MyDialog
                heading={t('pos.void.action')}
                open={open}
                onOpenChange={onOpenChange}
                dialogWidth="max-w-md"
                footer={
                    <div className="flex w-full justify-end gap-2">
                        <MyButton type="button" buttonType="secondary" scale="large" className="h-12" onClick={() => onOpenChange(false)}>
                            {t('common.cancel')}
                        </MyButton>
                        <MyButton type="button" buttonType="primary" scale="large" className="h-12" onAsyncClick={submit}>
                            {t('pos.void.action')}
                        </MyButton>
                    </div>
                }
            >
                <div className="flex flex-col gap-4">
                    <OrderNotice tone="warning">
                        <p className="font-medium">
                            {t('pos.void.which', {
                                number: sale.document?.number ?? sale.order_number,
                                amount: rupees(sale.totals.total),
                            })}
                        </p>
                        <p>{t('pos.void.hint')}</p>
                    </OrderNotice>
                    <PosField
                        label={t('pos.void.reason')}
                        htmlFor="pos-void-reason"
                        required
                        error={touched && !reasonOk ? t('pos.validation.reason') : null}
                    >
                        <input
                            id="pos-void-reason"
                            maxLength={500}
                            autoFocus
                            className={posInputClass}
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                        />
                    </PosField>
                    <PosErrorNotice error={error} />
                </div>
            </MyDialog>
            {pin.dialog}
        </>
    );
}
