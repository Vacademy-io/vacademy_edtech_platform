import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, Plus } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import {
    decimalsFor as unitDecimals,
    formatRate,
    lengthInputText,
    type LengthProblem,
    lengthProblemText,
    lineValuePaise,
    parseLength as parseTypedLength,
    toPaise,
    unitWord,
} from '@/routes/commerce/-shared/units';
import { useScanBurst } from '@/routes/commerce/-shared/use-scan-burst';
import { formatQuantity } from '@/routes/commerce/orders/-shared/order-format';
import { MAX_QUANTITY, quantityProblem } from '../-shared/pos-cart';
import { PosField, posInputClass, rupees, stockHint } from './pos-ui';

/** Decimals a person may type for a scale: 10 → 1, 100 → 2. */
export const decimalsFor = (qtyScale: number): number => unitDecimals(qtyScale);

export type LengthBoxProblem = LengthProblem | 'quantityStep' | 'quantityRange';

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
 * The length box for measured goods (cloth by the metre; WP-44 FA5, W6): the
 * price per metre, "N m here" as a hint (the server's ledger decides), − / +
 * one sale step (48 px), typing with at most the scale's decimals, the line
 * total for the typed length in paise after the line's discount, Enter saves.
 * It opens with its length selected, so typing "2" replaces "1" (never "12");
 * a label scanned into it goes to `onScan`; Save waits while the box is blank
 * or refused and the box stays open when the bill refuses the length.
 * Closing it without a save is the page's to handle (a line just added is
 * taken off the bill).
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
    lineDiscount = 0,
    onHand,
    onSave,
    onScan,
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
    /** Rupees off this line; the line total in the box is after it (as on the bill). */
    lineDiscount?: number;
    /** Stored units at this counter's location (a hint), null when untracked. */
    onHand: number | null;
    /** The page applies the length; `false` (refused) keeps the box open. */
    onSave: (stored: number) => boolean | void;
    /** A label scanned into the box (a scanner types where the focus is): the page's scan. */
    onScan?: (code: string) => void;
}) {
    const { t } = useTranslation('commerce');
    const [text, setText] = useState(() => lengthInputText(quantity, qtyScale));
    const inputRef = useRef<HTMLInputElement | null>(null);
    /** W6: the length opens selected, so the first key replaces it ("2" is 2 m, never "12"). */
    const selectPending = useRef(true);
    const [opening, setOpening] = useState(0);
    const burst = useScanBurst((code) => onScan?.(code));
    const selectAll = (node: HTMLInputElement | null) => {
        if (!node || !selectPending.current) return;
        selectPending.current = false;
        node.focus();
        node.select();
    };

    useEffect(() => {
        if (open) {
            setText(lengthInputText(quantity, qtyScale));
            selectPending.current = true;
            setOpening((n) => n + 1);
        }
    }, [open, quantity, qtyScale]);

    // The dialog may mount the box after this runs; the ref callback then selects instead.
    useEffect(() => selectAll(inputRef.current), [opening]);

    const parsed = parseLength(text, qtyScale, qtyStep);
    const problem = 'problem' in parsed ? parsed.problem : null;
    const stepText = formatQuantity(qtyStep, qtyScale, unit, t);
    // What − / + start from: the typed length even when it is off the step, else the line's.
    const loose = parseTypedLength(text, qtyScale);
    const current = 'stored' in loose ? loose.stored : quantity;
    // Every problem is said as soon as there is text; Save waits while there is one (W5).
    const problemText = !problem || text.trim() === ''
        ? null
        : problem === 'quantityStep' || problem === 'quantityRange'
          ? t(`pos.length.problems.${problem}`, { step: stepText })
          : lengthProblemText(problem, qtyScale, t);
    const here = stockHint(t, onHand, qtyScale, unit);
    const total =
        'stored' in parsed
            ? rupees(Math.max(0, lineValuePaise(unitPrice, parsed.stored) - toPaise(lineDiscount)) / 100)
            : null;

    const save = () => {
        if (!('stored' in parsed)) return;
        // n8: the box closes only when the bill took the length.
        if (onSave(parsed.stored) === false) return;
        onOpenChange(false);
    };
    const move = (direction: -1 | 1) => {
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
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="large"
                        className="h-12"
                        disable={problem ? true : undefined}
                        onClick={save}
                        data-testid="pos-length-save"
                    >
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
                    error={problemText}
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
                            ref={(node) => {
                                inputRef.current = node;
                                selectAll(node);
                            }}
                            autoFocus
                            inputMode="decimal"
                            autoComplete="off"
                            className={posInputClass}
                            value={text}
                            onChange={(event) => setText(event.target.value)}
                            onFocus={(event) => event.currentTarget.select()}
                            onKeyDown={(event) => {
                                const scanned = burst(event);
                                if (scanned) {
                                    setText(scanned.restore);
                                    return;
                                }
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
                    <span className="text-muted-foreground">
                        {t('pos.length.lineTotal')}
                        {lineDiscount > 0 && (
                            <span className="ms-1 text-caption">{t('pos.length.afterDiscount', { amount: rupees(lineDiscount) })}</span>
                        )}
                    </span>
                    <span className="tabular-nums text-subtitle font-medium text-foreground" data-testid="pos-length-total">
                        {total ?? '—'}
                    </span>
                </p>
            </div>
        </MyDialog>
    );
}
