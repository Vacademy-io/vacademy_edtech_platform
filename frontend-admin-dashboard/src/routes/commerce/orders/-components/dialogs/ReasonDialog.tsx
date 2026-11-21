import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { REASON_MOVES } from '@/routes/commerce/orders/-shared/order-actions';
import { clearStockShort, transitionOrder } from '@/routes/commerce/orders/-shared/order-api';
import { DialogButtons, OrderErrorAlert, OrderNotice, TextAreaField } from '../order-ui';
import type { OrderDialogProps } from './dialog-types';
import { useDialogWrite } from './use-dialog-write';

export type ReasonCode = 'UNPACK' | 'UNDO_SHIP' | 'UNDO_DELIVERY' | 'CLEAR_STOCK_SHORT';

type ReasonBody = { client_request_id: string; text: string };

/**
 * One required reason, then the step: Unpack, Undo shipped, Undo delivered
 * (manager moves on `/transition`) or Clear "stock short" (its own route, a note).
 */
export function ReasonDialog({ open, onOpenChange, detail, code }: OrderDialogProps & { code: ReasonCode }) {
    const { t } = useTranslation('commerce');
    const order = detail.order;
    const [text, setText] = useState('');
    const [touched, setTouched] = useState(false);
    const write = useDialogWrite(
        ({ client_request_id, text: value }: ReasonBody) => {
            if (code === 'CLEAR_STOCK_SHORT') {
                return clearStockShort(order.id, { client_request_id, note: value });
            }
            const move = REASON_MOVES[code];
            return transitionOrder(order.id, {
                client_request_id,
                from_status: order.status,
                to_status: move?.to ?? order.status,
                reason: value,
            });
        },
        { open, onOpenChange, currency: order.currency, prefix: 'rsn' }
    );
    useEffect(() => {
        if (open) {
            setText('');
            setTouched(false);
        }
    }, [open]);

    const missing = !text.trim();
    const submit = async () => {
        setTouched(true);
        if (missing) return;
        const done = await write.submit({ text: text.trim() });
        if (done) {
            toast.success(t(`orders.dialogs.reasonDone.${code}`));
            write.close();
        }
    };

    return (
        <MyDialog
            heading={t(`orders.actions.${code}`)}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-lg"
            footer={
                <DialogButtons onCancel={() => onOpenChange(false)}>
                    <MyButton type="button" buttonType="primary" scale="medium" onAsyncClick={submit}>
                        {t(`orders.actions.${code}`)}
                    </MyButton>
                </DialogButtons>
            }
        >
            <div className="flex flex-col gap-4">
                <OrderNotice tone="warning">{t(`orders.dialogs.reasonHelp.${code}`)}</OrderNotice>
                <TextAreaField
                    id="reason-text"
                    label={code === 'CLEAR_STOCK_SHORT' ? t('orders.note') : t('orders.reason')}
                    value={text}
                    onChange={setText}
                    required
                    error={touched && missing ? t('orders.dialogs.reasonRequired') : null}
                />
                <OrderErrorAlert error={write.error} currency={order.currency} />
            </div>
        </MyDialog>
    );
}
