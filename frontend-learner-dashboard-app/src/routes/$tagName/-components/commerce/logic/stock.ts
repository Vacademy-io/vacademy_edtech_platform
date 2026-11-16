/**
 * Stock as the shop shows it. The API sends a state and, only
 * at or below the low threshold, the number left in base units; nothing here guesses a count.
 */
import type { Stock } from '../api/types';

export type StockViewKind = 'in' | 'low' | 'single' | 'made_to_order' | 'out' | 'unknown';

export interface StockView {
    kind: StockViewKind;
    /** Base units left; only for "low" and "single". */
    left: number | null;
    purchasable: boolean;
    leadTimeDays: number | null;
}

export const stockView = (stock: Stock | null | undefined): StockView => {
    if (!stock) return { kind: 'unknown', left: null, purchasable: false, leadTimeDays: null };
    const left = typeof stock.left === 'number' && stock.left > 0 ? stock.left : null;
    switch (stock.state) {
        case 'OUT':
            return { kind: 'out', left: null, purchasable: false, leadTimeDays: null };
        case 'MADE_TO_ORDER':
            return { kind: 'made_to_order', left: null, purchasable: true, leadTimeDays: stock.lead_time_days ?? null };
        case 'LOW':
            return {
                kind: stock.single_piece ? 'single' : 'low',
                left,
                purchasable: stock.purchasable !== false,
                leadTimeDays: null,
            };
        case 'IN_STOCK':
            return { kind: 'in', left: null, purchasable: stock.purchasable !== false, leadTimeDays: null };
        default:
            return { kind: 'unknown', left: null, purchasable: !!stock.purchasable, leadTimeDays: null };
    }
};

export interface QuantityRules {
    /** Smallest quantity and the step, in base units. */
    step: number;
    /** Most that can be asked for, in base units; null = no known limit. */
    max: number | null;
}

/** The step from the product, and the ceiling from low stock when the API told us the number. */
export const quantityRules = (qtyStep: number, stock: Stock | null | undefined): QuantityRules => {
    const step = Math.max(1, Math.floor(qtyStep || 1));
    const view = stockView(stock);
    const max = view.left !== null ? Math.floor(view.left / step) * step : null;
    return { step, max: max !== null && max >= step ? max : view.left !== null ? 0 : null };
};

/**
 * A wanted quantity brought onto the step grid and inside the limits: rounded to the nearest
 * step, never below one step, never above the known ceiling. 0 when nothing can be bought.
 */
export const clampQuantity = (wanted: number, rules: QuantityRules): number => {
    if (rules.max === 0) return 0;
    const raw = Number.isFinite(wanted) ? wanted : rules.step;
    let quantity = Math.max(rules.step, Math.round(raw / rules.step) * rules.step);
    if (rules.max !== null) quantity = Math.min(quantity, rules.max);
    return quantity;
};

export interface LengthChoice {
    /** Base units. */
    quantity: number;
    /** Whole units as written by the seller (2.5). */
    units: number;
}

/**
 * The preset lengths of a product sold by length, as quantities of its one variant: each preset
 * (in metres) on the step grid, inside the stock ceiling, without duplicates, shortest first.
 */
export const lengthChoices = (presets: readonly number[], qtyScale: number, rules: QuantityRules): LengthChoice[] => {
    const scale = Math.max(1, Math.floor(qtyScale || 1));
    const seen = new Set<number>();
    const out: LengthChoice[] = [];
    for (const units of presets) {
        const quantity = Math.round(units * scale);
        if (!Number.isFinite(quantity) || quantity < rules.step || quantity % rules.step !== 0) continue;
        if (rules.max !== null && quantity > rules.max) continue;
        if (seen.has(quantity)) continue;
        seen.add(quantity);
        out.push({ quantity, units: quantity / scale });
    }
    return out.sort((a, b) => a.quantity - b.quantity);
};

/** A product sold by length or weight: more than one base unit in a unit. */
export const isMeasured = (qtyScale: number): boolean => Math.floor(qtyScale || 1) > 1;
