import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { cn } from '@/lib/utils';
import { useChangeTender } from '../-shared/pos-hooks';
import { modeLabel } from '../-shared/pos-receipt';
import {
    type PosTenderMode,
    REFERENCE_REQUIRED_MODES,
    type SaleAnswer,
    type SaleTender,
    TENDER_MODES_POS,
} from '../-shared/pos-types';
import { usePinWrite } from './PosPinGate';
import { PosErrorNotice, PosField, posInputClass, rupees } from './pos-ui';

/**
 * Change how one payment of a bill was taken (cash → UPI…), same amount
 * (contract §4.2). A cashier needs a manager's PIN.
 */
export function PosTenderChangeDialog({
    orderId,
    tender,
    registerId,
    onOpenChange,
    onDone,
}: {
    orderId: string;
    tender: SaleTender | null;
    registerId: string | null;
    onOpenChange: (open: boolean) => void;
    onDone: (answer: SaleAnswer) => void;
}) {
    const { t } = useTranslation('commerce');
    const write = useChangeTender();
    const pin = usePinWrite(registerId, 'postender');
    const [mode, setMode] = useState<PosTenderMode>('UPI');
    const [reference, setReference] = useState('');
    const [touched, setTouched] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const open = !!tender;
    const { reset } = pin;

    useEffect(() => {
        if (!tender) return;
        setMode(tender.mode === 'CASH' ? 'UPI' : 'CASH');
        setReference('');
        setTouched(false);
        setError(null);
        reset();
    }, [tender, reset]);

    const needsRef = REFERENCE_REQUIRED_MODES.has(mode);
    const refOk = !needsRef || /^[A-Za-z0-9 /_.:#-]{1,100}$/.test(reference.trim());
    const same = tender?.mode === mode && (tender?.reference ?? '') === reference.trim();

    const submit = async () => {
        setTouched(true);
        if (!tender || !refOk || same) return;
        setError(null);
        const body = { mode, ...(reference.trim() ? { reference: reference.trim() } : {}) };
        try {
            await pin.run(body, (full) => write.mutateAsync([orderId, tender.id, full]), (answer) => {
                toast.success(t('pos.tenderChange.done'));
                onDone(answer);
                onOpenChange(false);
            });
        } catch (raw) {
            setError(raw);
        }
    };

    return (
        <>
            <MyDialog
                heading={t('pos.tenderChange.action')}
                open={open}
                onOpenChange={onOpenChange}
                dialogWidth="max-w-md"
                footer={
                    <div className="flex w-full justify-end gap-2">
                        <MyButton type="button" buttonType="secondary" scale="large" className="h-12" onClick={() => onOpenChange(false)}>
                            {t('common.cancel')}
                        </MyButton>
                        <MyButton type="button" buttonType="primary" scale="large" className="h-12" disable={same} onAsyncClick={submit}>
                            {t('common.save')}
                        </MyButton>
                    </div>
                }
            >
                {tender && (
                    <div className="flex flex-col gap-4">
                        <p className="text-body text-foreground">
                            {t('pos.tenderChange.from', {
                                mode: modeLabel(tender.mode, t),
                                amount: rupees(tender.amount),
                            })}
                        </p>
                        <div role="radiogroup" aria-label={t('pos.tenderChange.to')} className="grid grid-cols-3 gap-2">
                            {TENDER_MODES_POS.map((m) => (
                                <button
                                    key={m}
                                    type="button"
                                    role="radio"
                                    aria-checked={mode === m}
                                    onClick={() => setMode(m)}
                                    className={cn(
                                        'min-h-12 rounded-md border px-2 text-body',
                                        mode === m
                                            ? 'border-primary-500 bg-primary-50 text-primary-500'
                                            : 'border-neutral-300 text-neutral-600'
                                    )}
                                >
                                    {t(`orders.tender.${m}`)}
                                </button>
                            ))}
                        </div>
                        {mode !== 'CASH' && (
                            <PosField
                                label={t('pos.tender.reference')}
                                htmlFor="pos-tender-ref"
                                required={needsRef}
                                error={touched && !refOk ? t('pos.validation.reference') : null}
                            >
                                <input
                                    id="pos-tender-ref"
                                    maxLength={100}
                                    className={posInputClass}
                                    value={reference}
                                    onChange={(event) => setReference(event.target.value)}
                                />
                            </PosField>
                        )}
                        {same && <p className="text-caption text-muted-foreground">{t('pos.tenderChange.same')}</p>}
                        <PosErrorNotice error={error} />
                    </div>
                )}
            </MyDialog>
            {pin.dialog}
        </>
    );
}
