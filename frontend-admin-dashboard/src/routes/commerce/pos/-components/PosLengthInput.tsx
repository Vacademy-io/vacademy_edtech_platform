import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { displayQuantity, formatQuantity, storedQuantity } from '@/routes/commerce/orders/-shared/order-format';
import { quantityProblem } from '../-shared/pos-cart';
import { PosField, posInputClass } from './pos-ui';

/** Decimals a person may type for a scale: 10 → 1, 100 → 2. */
export const decimalsFor = (qtyScale: number): number =>
    qtyScale > 1 ? Math.max(1, Math.round(Math.log10(qtyScale))) : 0;

/**
 * Typed length → stored units, or the reason it is refused (contract §7.6):
 * a number with at most the scale's decimals, a multiple of `qty_step`, within
 * 1 step .. 100000 stored units.
 */
export function parseLength(
    text: string,
    qtyScale: number,
    qtyStep: number
): { stored: number } | { problem: 'format' | 'quantityStep' | 'quantityRange' } {
    const digits = decimalsFor(qtyScale);
    const pattern = digits > 0 ? new RegExp(`^\\d{1,6}(\\.\\d{1,${digits}})?$`) : /^\d{1,6}$/;
    const trimmed = text.trim();
    if (!pattern.test(trimmed)) return { problem: 'format' };
    const stored = storedQuantity(Number(trimmed), qtyScale);
    const problem = quantityProblem({ qtyStep }, stored);
    return problem ? { problem: problem === 'quantityStep' ? 'quantityStep' : 'quantityRange' } : { stored };
}

/**
 * The length box for measured goods (cloth by the metre). The minimum WP-43
 * needs: one number in the display unit; WP-44 adds presets and the label box.
 */
export function PosLengthInput({
    open,
    onOpenChange,
    name,
    unit,
    qtyScale,
    qtyStep,
    quantity,
    onSave,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    name: string;
    unit: string | null;
    qtyScale: number;
    qtyStep: number;
    /** Current stored quantity. */
    quantity: number;
    onSave: (stored: number) => void;
}) {
    const { t } = useTranslation('commerce');
    const [text, setText] = useState('');
    const [touched, setTouched] = useState(false);

    useEffect(() => {
        if (open) {
            setText(String(displayQuantity(quantity, qtyScale)));
            setTouched(false);
        }
    }, [open, quantity, qtyScale]);

    const parsed = parseLength(text, qtyScale, qtyStep);
    const problem = 'problem' in parsed ? parsed.problem : null;
    const stepText = formatQuantity(qtyStep, qtyScale, unit, t);

    const save = () => {
        setTouched(true);
        if ('stored' in parsed) {
            onSave(parsed.stored);
            onOpenChange(false);
        }
    };

    return (
        <MyDialog
            heading={t('pos.length.title', { name })}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-md"
            footer={
                <div className="flex w-full justify-end gap-2">
                    <MyButton type="button" buttonType="secondary" scale="large" className="h-12" onClick={() => onOpenChange(false)}>
                        {t('common.cancel')}
                    </MyButton>
                    <MyButton type="button" buttonType="primary" scale="large" className="h-12" onClick={save}>
                        {t('common.save')}
                    </MyButton>
                </div>
            }
        >
            <PosField
                label={t('pos.length.label', { unit: unit || t('orders.units.metre') })}
                htmlFor="pos-length"
                hint={t('pos.length.hint', { step: stepText })}
                error={touched && problem ? t(`pos.length.problems.${problem}`, { step: stepText }) : null}
            >
                <input
                    id="pos-length"
                    autoFocus
                    inputMode="decimal"
                    className={posInputClass}
                    value={text}
                    onChange={(event) => setText(event.target.value.replace(/[^\d.]/g, ''))}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') save();
                    }}
                />
            </PosField>
        </MyDialog>
    );
}
