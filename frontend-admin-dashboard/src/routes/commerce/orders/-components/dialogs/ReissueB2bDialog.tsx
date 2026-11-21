import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import { gstinProblem, normalizeGstin } from '@/routes/commerce/-shared/gstin';
import { reissueInvoiceB2b } from '@/routes/commerce/orders/-shared/order-api';
import type { OrderError } from '@/routes/commerce/orders/-shared/order-errors';
import { invalidateOrders } from '@/routes/commerce/orders/-shared/order-hooks';
import { DialogButtons, Field, OrderErrorAlert, useOrderErrorHandler } from '../order-ui';
import type { OrderDialogProps } from './dialog-types';

/** Reissue the invoice to a business buyer with a GSTIN (manager). */
export function ReissueB2bDialog({ open, onOpenChange, detail }: OrderDialogProps) {
    const { t } = useTranslation('commerce');
    const queryClient = useQueryClient();
    const handle = useOrderErrorHandler();
    const [gstin, setGstin] = useState('');
    const [name, setName] = useState('');
    const [touched, setTouched] = useState(false);
    const [error, setError] = useState<OrderError | null>(null);
    useEffect(() => {
        if (!open) return;
        setGstin('');
        setName('');
        setTouched(false);
        setError(null);
    }, [open]);

    const clean = normalizeGstin(gstin);
    const problem = gstinProblem(clean);
    const submit = async () => {
        setTouched(true);
        if (problem || !detail.invoice_id) return;
        setError(null);
        try {
            await reissueInvoiceB2b(detail.invoice_id, {
                buyer_gstin: clean,
                ...(name.trim() ? { buyer_name: name.trim() } : {}),
            });
            void invalidateOrders(queryClient);
            toast.success(t('orders.dialogs.reissue.done'));
            onOpenChange(false);
        } catch (raw) {
            setError(handle(raw, { close: () => onOpenChange(false), currency: detail.order.currency }));
        }
    };

    return (
        <MyDialog
            heading={t('orders.actions.REISSUE_B2B')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-md"
            footer={
                <DialogButtons onCancel={() => onOpenChange(false)}>
                    <MyButton type="button" buttonType="primary" scale="medium" onAsyncClick={submit}>
                        {t('orders.dialogs.reissue.submit')}
                    </MyButton>
                </DialogButtons>
            }
        >
            <div className="flex flex-col gap-4">
                <p className="text-body text-muted-foreground">{t('orders.dialogs.reissue.help')}</p>
                <Field
                    label={t('orders.dialogs.reissue.gstin')}
                    htmlFor="reissue-gstin"
                    required
                    error={touched && problem ? t(`business.validation.gstin.${problem}`) : null}
                >
                    <MyInput
                        id="reissue-gstin"
                        input={gstin}
                        maxLength={20}
                        autoCapitalize="characters"
                        onChangeFunction={(event) => setGstin(event.target.value)}
                        className="sm:w-full"
                    />
                </Field>
                <Field label={t('orders.dialogs.reissue.legalName')} htmlFor="reissue-name">
                    <MyInput
                        id="reissue-name"
                        input={name}
                        maxLength={200}
                        onChangeFunction={(event) => setName(event.target.value)}
                        className="sm:w-full"
                    />
                </Field>
                <OrderErrorAlert error={error} currency={detail.order.currency} />
            </div>
        </MyDialog>
    );
}
