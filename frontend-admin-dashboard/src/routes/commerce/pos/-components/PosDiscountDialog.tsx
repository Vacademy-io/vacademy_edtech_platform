import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { cn } from '@/lib/utils';
import type { BillDiscount } from '../-shared/pos-cart';
import { PosField, posInputClass, rupees, sanitizeAmount } from './pos-ui';

export type DiscountTarget =
    | { kind: 'line'; lineRef: string; name: string; gross: number; current: number }
    | { kind: 'bill'; gross: number; current: BillDiscount | null };

/**
 * A discount on one line (rupees) or on the whole bill (rupees or percent),
 * always with a reason. A cashier above the shop's limit gets the manager-PIN
 * step at payment (the server decides, `needs_approval`); the hint says so.
 */
export function PosDiscountDialog({
    target,
    reason,
    limitPercent,
    onOpenChange,
    onSave,
}: {
    target: DiscountTarget | null;
    reason: string;
    /** The shop's cashier limit (percent of goods); null when unknown. */
    limitPercent: number | null;
    onOpenChange: (open: boolean) => void;
    onSave: (value: { amount: number; kind: 'AMOUNT' | 'PERCENT'; reason: string } | null) => void;
}) {
    const { t } = useTranslation('commerce');
    const open = !!target;
    const [kind, setKind] = useState<'AMOUNT' | 'PERCENT'>('AMOUNT');
    const [value, setValue] = useState('');
    const [why, setWhy] = useState('');
    const [touched, setTouched] = useState(false);

    useEffect(() => {
        if (!target) return;
        setTouched(false);
        setWhy(reason);
        if (target.kind === 'line') {
            setKind('AMOUNT');
            setValue(target.current > 0 ? target.current.toFixed(2) : '');
        } else {
            setKind(target.current?.kind ?? 'AMOUNT');
            setValue(target.current ? String(target.current.value) : '');
        }
    }, [target, reason]);

    const number = Number(value);
    const max = kind === 'PERCENT' ? 100 : (target?.gross ?? 0);
    const valueOk = value.trim() !== '' && Number.isFinite(number) && number > 0 && number <= max;
    const reasonOk = why.trim().length > 0 && why.trim().length <= 200;

    const save = () => {
        setTouched(true);
        if (!valueOk || !reasonOk) return;
        onSave({ amount: Math.round(number * 100) / 100, kind, reason: why.trim() });
        onOpenChange(false);
    };

    const remove = () => {
        onSave(null);
        onOpenChange(false);
    };

    const hasCurrent = target?.kind === 'line' ? target.current > 0 : !!target?.current;

    return (
        <MyDialog
            heading={target?.kind === 'line' ? t('pos.discount.lineTitle', { name: target.name }) : t('pos.sell.billDiscount')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-md"
            footer={
                <div className="flex w-full flex-wrap justify-end gap-2">
                    {hasCurrent && (
                        <MyButton type="button" buttonType="text" scale="large" className="h-12" onClick={remove}>
                            {t('pos.discount.remove')}
                        </MyButton>
                    )}
                    <MyButton type="button" buttonType="secondary" scale="large" className="h-12" onClick={() => onOpenChange(false)}>
                        {t('common.cancel')}
                    </MyButton>
                    <MyButton type="button" buttonType="primary" scale="large" className="h-12" onClick={save}>
                        {t('common.save')}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-4">
                {target?.kind === 'bill' && (
                    <div role="radiogroup" aria-label={t('pos.discount.kind')} className="grid grid-cols-2 gap-2">
                        {(['AMOUNT', 'PERCENT'] as const).map((k) => (
                            <button
                                key={k}
                                type="button"
                                role="radio"
                                aria-checked={kind === k}
                                onClick={() => setKind(k)}
                                className={cn(
                                    'min-h-12 rounded-md border text-subtitle',
                                    kind === k
                                        ? 'border-primary-500 bg-primary-50 text-primary-500'
                                        : 'border-neutral-300 text-neutral-600'
                                )}
                            >
                                {t(`pos.discount.kinds.${k}`)}
                            </button>
                        ))}
                    </div>
                )}
                <PosField
                    label={kind === 'PERCENT' ? t('pos.discount.percent') : t('pos.discount.amount')}
                    htmlFor="pos-discount-value"
                    required
                    hint={t('pos.discount.goods', { amount: rupees(target?.gross ?? 0) })}
                    error={
                        touched && !valueOk
                            ? kind === 'PERCENT'
                                ? t('pos.discount.percentRange')
                                : t('pos.discount.amountRange', { amount: rupees(max) })
                            : null
                    }
                >
                    <input
                        id="pos-discount-value"
                        inputMode="decimal"
                        autoFocus
                        className={posInputClass}
                        value={value}
                        onChange={(event) => setValue(sanitizeAmount(event.target.value))}
                    />
                </PosField>
                <PosField
                    label={t('pos.sell.discountReason')}
                    htmlFor="pos-discount-reason"
                    required
                    error={touched && !reasonOk ? t('pos.validation.reason') : null}
                >
                    <input
                        id="pos-discount-reason"
                        maxLength={200}
                        className={posInputClass}
                        value={why}
                        onChange={(event) => setWhy(event.target.value)}
                    />
                </PosField>
                {limitPercent !== null && (
                    <p className="text-caption text-muted-foreground">
                        {t('pos.discount.limitHint', { percent: limitPercent })}
                    </p>
                )}
            </div>
        </MyDialog>
    );
}
