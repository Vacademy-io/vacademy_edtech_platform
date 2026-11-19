import type { TFunction } from 'i18next';
import { isMeasuredScale, lengthInputText, type LengthProblem, parseLength, unitWord } from '@/routes/commerce/-shared/units';

/**
 * Typed quantities in the order dialogs (return create, return receive, RTO
 * receive, cancel line; WP-44 FA4). Measured lines are typed in metres and
 * sent in base units; extra decimals are refused, never rounded. Returns,
 * cancels and RTO take any whole base unit: the sale step does not apply (D3, D7).
 */

/** A quantity box: blank → 0; refused text → the problem. */
export function typedQuantity(
    text: string | undefined,
    qtyScale: number | null | undefined
): { stored: number } | { problem: LengthProblem } {
    if (text === undefined || text.trim() === '') return { stored: 0 };
    return parseLength(text, qtyScale);
}

/** The base units of a box, or null when its text is refused. */
export const typedStored = (text: string | undefined, qtyScale: number | null | undefined): number | null => {
    const parsed = typedQuantity(text, qtyScale);
    return 'stored' in parsed ? parsed.stored : null;
};

export interface ConditionEntry {
    resaleable: string;
    damaged: string;
}

/**
 * A received line split into resaleable and damaged: both in base units, or
 * why it cannot be taken (a refused box, or the two not adding up to `total`).
 */
export function conditionSplit(
    entry: ConditionEntry | undefined,
    qtyScale: number | null | undefined,
    total: number
): { good: number; bad: number } | { problem: LengthProblem | 'sum' } {
    const good = typedQuantity(entry?.resaleable, qtyScale);
    if ('problem' in good) return { problem: good.problem };
    const bad = typedQuantity(entry?.damaged, qtyScale);
    if ('problem' in bad) return { problem: bad.problem };
    if (good.stored + bad.stored !== total) return { problem: 'sum' };
    return { good: good.stored, bad: bad.stored };
}

/** The first text of the resaleable box: the whole received quantity ("3.4" for 34 at scale 10). */
export const wholeText = (quantity: number, qtyScale: number | null | undefined): string =>
    lengthInputText(quantity, qtyScale);

/** Lines of a return request from the typed boxes: only lines with a valid quantity above 0. */
export function returnRequestLines(
    lines: { id: string; qty_scale: number | null | undefined }[],
    quantities: Record<string, string>
): { order_line_id: string; quantity: number }[] {
    return lines
        .map((line) => ({ order_line_id: line.id, quantity: typedStored(quantities[line.id], line.qty_scale) ?? 0 }))
        .filter((line) => line.quantity > 0);
}

/**
 * Where "cancel part of a line" starts: a measured line at its whole open
 * length (D8: "1" would mean 1 m), a counted line at 1.
 */
export const cancelStartText = (line: { qty_scale: number | null | undefined } | null, openQuantity: number): string =>
    line && isMeasuredScale(line.qty_scale) ? lengthInputText(openQuantity, line.qty_scale) : '1';

/** "Resaleable (m)" for a measured line, "Resaleable" for counted goods. */
export function conditionLabel(
    kind: 'resaleable' | 'damaged',
    qtyScale: number | null | undefined,
    unit: string | null | undefined,
    t: TFunction
): string {
    const label = t(kind === 'resaleable' ? 'orders.condition.RESALEABLE' : 'orders.condition.DAMAGED');
    return qtyScale && qtyScale > 1 ? t('orders.units.withUnit', { label, unit: unitWord(unit, t) ?? '' }) : label;
}
