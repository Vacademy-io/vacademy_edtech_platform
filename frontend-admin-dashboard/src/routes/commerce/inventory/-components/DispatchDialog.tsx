import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, Printer } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { DialogButtons, Field, inputClass, OrderNotice } from '@/routes/commerce/orders/-components/order-ui';
import { dispatchTransfer } from '../-shared/inventory-api';
import { readInventoryError } from '../-shared/inventory-errors';
import { useInvalidateInventory, useInventoryAccess } from '../-shared/inventory-hooks';
import type { DispatchBody, TransferView } from '../-shared/inventory-types';
import { promisedOnlineText } from '../-shared/transfer-lines';
import { InventoryErrorNotice, TOUCH, useInventoryErrorText } from './inventory-ui';
import { EWAY_HINT_ABOVE, useChallanPrint, valueText } from './transfer-ui';
import { useInventoryWrite } from './use-inventory-write';

const EWAY = /^[A-Za-z0-9]{1,32}$/;
const DOCUMENT = /^[A-Za-z0-9/ _.-]{1,64}$/;

/** The dispatch body for what the dialog holds (pure, so the request id follows it). */
export function dispatchBody(input: {
    gstinDiffers: boolean;
    ewayBill: string;
    documentNumber: string;
    confirmPromised: boolean;
}): Omit<DispatchBody, 'client_request_id'> {
    return {
        ...(input.ewayBill.trim() ? { eway_bill_no: input.ewayBill.trim() } : {}),
        ...(input.gstinDiffers
            ? { document_type: 'EXTERNAL_INVOICE' as const, document_number: input.documentNumber.trim() }
            : {}),
        ...(input.confirmPromised ? { confirm_promised_online: true } : {}),
    };
}

/**
 * Dispatch (contract §3.4, §7.3): totals and value, the e-way bill number
 * (with a hint above ₹50,000). Two places with different GSTINs: a manager
 * records the external document's number; anyone else reads why and cannot
 * dispatch. `PROMISED_ONLINE`: a manager may send anyway (a new body, so a
 * new request id; the refused request left nothing behind). On success the
 * challan can be printed.
 */
export function DispatchDialog({
    open,
    onOpenChange,
    view,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    view: TransferView;
}) {
    const { t } = useTranslation('commerce');
    const access = useInventoryAccess();
    const invalidate = useInvalidateInventory();
    const errorText = useInventoryErrorText();
    const write = useInventoryWrite('dsp');
    const challan = useChallanPrint();
    const [ewayBill, setEwayBill] = useState('');
    const [documentNumber, setDocumentNumber] = useState('');
    const [promised, setPromised] = useState<string | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [error, setError] = useState<unknown>(null);
    const [done, setDone] = useState<TransferView | null>(null);
    const blocked = view.gstin_differs && !access.isManager;
    const value = view.totals.value;

    const send = async (confirmPromised: boolean) => {
        setProblem(null);
        setError(null);
        if (ewayBill.trim() && !EWAY.test(ewayBill.trim())) return setProblem(t('inventory.dispatch.ewayRule'));
        if (view.gstin_differs && !DOCUMENT.test(documentNumber.trim())) return setProblem(t('inventory.dispatch.documentRule'));
        const body = dispatchBody({ gstinDiffers: view.gstin_differs, ewayBill, documentNumber, confirmPromised });
        try {
            await write.run({
                scope: `dispatch:${view.id}`,
                body,
                send: (id) => dispatchTransfer(view.id, { ...body, client_request_id: id }),
                onDone: (answer) => {
                    setPromised(null);
                    setDone(answer);
                    void invalidate();
                },
            });
        } catch (e) {
            const read = readInventoryError(e);
            if (read.code === 'PROMISED_ONLINE') {
                const question = promisedOnlineText(read.values, t);
                setPromised(access.isManager && question ? question : errorText(read));
                return;
            }
            setError(e);
        }
    };

    if (done) {
        return (
            <MyDialog heading={t('inventory.transfers.dispatch')} open={open} onOpenChange={onOpenChange} dialogWidth="max-w-md">
                <div className="flex flex-col gap-4">
                    <p className="flex items-center gap-2 text-subtitle text-success-600" role="status">
                        <CheckCircle size={24} weight="fill" />
                        {t('inventory.dispatch.done', { number: done.document_number ?? done.transfer_number ?? '' })}
                    </p>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="large"
                        className="h-14"
                        onAsyncClick={() => challan.print(done)}
                        data-testid="dispatch-print-challan"
                    >
                        <Printer size={18} />
                        {t('inventory.transfers.printChallan')}
                    </MyButton>
                    <InventoryErrorNotice error={challan.error} />
                </div>
            </MyDialog>
        );
    }

    return (
        <>
            <MyDialog
                heading={t('inventory.transfers.dispatch')}
                open={open && !write.pinOpen}
                onOpenChange={onOpenChange}
                dialogWidth="max-w-lg"
                footer={
                    <DialogButtons onCancel={() => onOpenChange(false)}>
                        {!blocked && promised === null && (
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="medium"
                                className={TOUCH}
                                onAsyncClick={() => send(false)}
                                data-testid="dispatch-send"
                            >
                                {t('inventory.transfers.dispatch')}
                            </MyButton>
                        )}
                        {!blocked && promised !== null && access.isManager && (
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="medium"
                                className={TOUCH}
                                onAsyncClick={() => send(true)}
                                data-testid="dispatch-send-anyway"
                            >
                                {t('inventory.dispatch.sendAnyway')}
                            </MyButton>
                        )}
                    </DialogButtons>
                }
            >
                <div className="flex flex-col gap-4">
                    <dl className="grid grid-cols-2 gap-3">
                        <div>
                            <dt className="text-caption text-muted-foreground">{t('inventory.transfers.lines')}</dt>
                            <dd className="text-body tabular-nums">{view.lines.length}</dd>
                        </div>
                        <div>
                            <dt className="text-caption text-muted-foreground">{t('inventory.dispatch.value')}</dt>
                            <dd className="text-body tabular-nums">{valueText(value)}</dd>
                        </div>
                    </dl>
                    {blocked ? (
                        <OrderNotice tone="warning">{t('inventory.transfers.needsDocument')}</OrderNotice>
                    ) : (
                        <>
                            <Field
                                label={t('inventory.transfers.ewayBill')}
                                htmlFor="eway-bill"
                                hint={value !== null && value > EWAY_HINT_ABOVE ? t('inventory.transfers.ewayHint') : undefined}
                            >
                                <input
                                    id="eway-bill"
                                    className={inputClass}
                                    value={ewayBill}
                                    maxLength={32}
                                    onChange={(event) => setEwayBill(event.target.value)}
                                />
                            </Field>
                            {view.gstin_differs && (
                                <>
                                    <OrderNotice tone="info">{t('inventory.transfers.needsDocument')}</OrderNotice>
                                    <p className="text-body">
                                        {t('inventory.dispatch.documentType')}: {t('inventory.dispatch.externalInvoice')}
                                    </p>
                                    <Field label={t('inventory.dispatch.documentNumber')} htmlFor="doc-number" required>
                                        <input
                                            id="doc-number"
                                            data-testid="dispatch-document-number"
                                            className={inputClass}
                                            value={documentNumber}
                                            maxLength={64}
                                            onChange={(event) => setDocumentNumber(event.target.value)}
                                        />
                                    </Field>
                                </>
                            )}
                        </>
                    )}
                    {promised !== null && (
                        <OrderNotice tone="warning">
                            <span data-testid="dispatch-promised">{promised}</span>
                        </OrderNotice>
                    )}
                    {problem && (
                        <p role="alert" className="text-caption text-danger-600">
                            {problem}
                        </p>
                    )}
                    <InventoryErrorNotice error={error} />
                </div>
            </MyDialog>
            {write.dialog}
        </>
    );
}
