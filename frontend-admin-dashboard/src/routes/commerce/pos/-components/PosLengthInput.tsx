import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, Plus } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import {
    decimalsFor as unitDecimals,
    formatRate,
    lengthInputText,
    lineValuePaise,
    parseLength as parseTypedLength,
    unitWord,
} from '@/routes/commerce/-shared/units';
import { formatQuantity } from '@/routes/commerce/orders/-shared/order-format';
import { MAX_QUANTITY, quantityProblem } from '../-shared/pos-cart';
import { PosField, posInputClass, rupees, stockHint } from './pos-ui';

/** Decimals a person may type for a scale: 10 → 1, 100 → 2. */
export const decimalsFor = (qtyScale: number): number => unitDecimals(qtyScale);

export type LengthBoxProblem = 'format' | 'decimals' | 'quantityStep' | 'quantityRange';

/**
 * Typed length → stored units, or the reason it is refused: a number with at
 * most the scale's decimals (more is refused, never rounded), a multiple of
 * `qty_step`, within 1 step .. 100000 stored units.
 */
export function parseLength(
    text: string,
    qtyScale: number,
    qtyStep: number
): { stored: number } | { problem: LengthBoxProblem } {
    const parsed = parseTypedLength(text, qtyScale);
    if ('problem' in parsed) return { problem: parsed.problem };
    const problem = quantityProblem({ qtyStep }, parsed.stored);
    return problem ? { problem: problem === 'quantityStep' ? 'quantityStep' : 'quantityRange' } : { stored: parsed.stored };
}

/** One step down or up from what is typed (or the line's length), kept within 1 step .. the maximum. */
export function stepLength(current: number, qtyStep: number, direction: -1 | 1): number {
    const step = Math.max(1, qtyStep);
    // Off-grid text (2.3 m at a 0.5 m step) moves to the nearest step in that direction first.
    const onGrid = direction > 0 ? Math.ceil(current / step) * step : Math.floor(current / step) * step;
    const next = onGrid === current ? current + direction * step : onGrid;
    return Math.min(Math.floor(MAX_QUANTITY / step) * step, Math.max(step, next));
}

const stepButtonClass =
    'flex size-12 shrink-0 items-center justify-center rounded-md border border-neutral-300 bg-background text-foreground hover:border-primary-500 disabled:opacity-40';

/**
 * The length box for measured goods (cloth by the metre; WP-44 FA5): the
 * price per metre, "N m here" as a hint (the server's ledger decides), − / +
 * one sale step (48 px), typing with at most the scale's decimals, the line
 * total for the typed length in paise, Enter saves. Closing it without a save
 * is the page's to handle (a line just added is taken off the bill).
 */
export function PosLengthInput({
    open,
    onOpenChange,
    name,
    unit,
    qtyScale,
    qtyStep,
    quantity,
    unitPrice,
    onHand,
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
    /** Price per base unit (12.34 for ₹123.40 a metre). */
    unitPrice: number;
    /** Stored units at this counter's location (a hint), null when untracked. */
    onHand: number | null;
    onSave: (stored: number) => void;
}) {
    const { t } = useTranslation('commerce');
    const [text, setText] = useState('');
    const [touched, setTouched] = useState(false);

    useEffect(() => {
        if (open) {
            setText(lengthInputText(quantity, qtyScale));
            setTouched(false);
        }
    }, [open, quantity, qtyScale]);

    const parsed = parseLength(text, qtyScale, qtyStep);
    const problem = 'problem' in parsed ? parsed.problem : null;
    const stepText = formatQuantity(qtyStep, qtyScale, unit, t);
    // What − / + start from: the typed length even when it is off the step, else the line's.
    const loose = parseTypedLength(text, qtyScale);
    const current = 'stored' in loose ? loose.stored : quantity;
    // Extra decimals and non-numbers are said at once; step and range after Save.
    const showProblem = !!problem && (touched || ((problem === 'decimals' || problem === 'format') && text.trim() !== ''));
    const here = stockHint(t, onHand, qtyScale, unit);
    const total = 'stored' in parsed ? rupees(lineValuePaise(unitPrice, parsed.stored) / 100) : null;

    const save = () => {
        setTouched(true);
        if ('stored' in parsed) {
            onSave(parsed.stored);
            onOpenChange(false);
        }
    };
    const move = (direction: -1 | 1) => {
        setTouched(false);
        setText(lengthInputText(stepLength(current, qtyStep, direction), qtyScale));
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
            <div className="flex flex-col gap-3">
                <p className="flex flex-wrap items-baseline justify-between gap-2 text-body text-foreground">
                    <span className="tabular-nums font-medium" data-testid="pos-length-rate">
                        {formatRate(unitPrice, qtyScale, unit, 'INR', t)}
                    </span>
                    {here && <span className="text-caption text-muted-foreground">{here}</span>}
                </p>
                <PosField
                    label={t('pos.length.label', { unit: unitWord(unit, t) ?? t('orders.units.metre') })}
                    htmlFor="pos-length"
                    hint={t('pos.length.hint', { step: stepText })}
                    error={showProblem ? t(`pos.length.problems.${problem}`, { step: stepText, count: decimalsFor(qtyScale) }) : null}
                >
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            className={stepButtonClass}
                            aria-label={t('pos.length.less', { step: stepText })}
                            data-testid="pos-length-less"
                            disabled={current <= qtyStep}
                            onClick={() => move(-1)}
                        >
                            <Minus size={20} />
                        </button>
                        <input
                            id="pos-length"
                            autoFocus
                            inputMode="decimal"
                            className={posInputClass}
                            value={text}
                            onChange={(event) => setText(event.target.value.replace(/[^\d.,]/g, ''))}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') save();
                            }}
                        />
                        <button
                            type="button"
                            className={stepButtonClass}
                            aria-label={t('pos.length.more', { step: stepText })}
                            data-testid="pos-length-more"
                            onClick={() => move(1)}
                        >
                            <Plus size={20} />
                        </button>
                    </div>
                </PosField>
                <p className="flex items-baseline justify-between gap-2 text-body">
                    <span className="text-muted-foreground">{t('pos.length.lineTotal')}</span>
                    <span className="tabular-nums text-subtitle font-medium text-foreground" data-testid="pos-length-total">
                        {total ?? '—'}
                    </span>
                </p>
            </div>
        </MyDialog>
    );
}
