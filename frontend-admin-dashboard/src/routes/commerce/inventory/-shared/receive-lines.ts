import type { ReceiveSource } from './inventory-types';
import { MAX_BASE_UNITS } from './transfer-lines';

/**
 * The lines of a goods receipt on the Receive tab, pure: one line per item;
 * a scan of an item already on the list adds its step; quantities are base
 * units; one-of-a-kind items come in whole numbers (each piece gets its own
 * label and code at the server).
 */

export interface ReceiveItem {
    package_session_id: string;
    sku: string | null;
    name: string | null;
    variant_name: string | null;
    stock_mode: string | null;
    stock_policy: string | null;
    unit: string | null;
    qty_scale: number;
    qty_step: number;
    /** A quick-added item: a draft until a manager sets the price. */
    draft?: boolean;
}

export interface ReceiptLineDraft extends ReceiveItem {
    quantity: number;
}

export const RECEIVE_REFUSALS = ['untracked', 'quantityRange', 'typeLength'] as const;
export type ReceiveRefusal = (typeof RECEIVE_REFUSALS)[number];

const stepOf = (item: ReceiveItem) =>
    (item.stock_mode ?? '').toUpperCase() === 'PIECE' ? 1 : Math.max(1, Math.floor(item.qty_step || 1));

/**
 * Adds an item. A scanned measured item (cloth by the metre) never adds its
 * step (one base unit, 0.1 m): a new line starts empty and its length must be
 * typed (`typeLength`); a scan of a line already there only asks for it.
 */
export function addReceiveItem(
    lines: ReceiptLineDraft[],
    item: ReceiveItem,
    options: { scanned?: boolean } = {}
): { lines: ReceiptLineDraft[]; refusal: ReceiveRefusal | null } {
    if ((item.stock_policy ?? '').toUpperCase() === 'UNTRACKED') return { lines, refusal: 'untracked' };
    const step = stepOf(item);
    const existing = lines.find((l) => l.package_session_id === item.package_session_id);
    const measured = item.qty_scale > 1 && (item.stock_mode ?? '').toUpperCase() !== 'PIECE';
    if (options.scanned && measured) {
        if (existing) return { lines, refusal: 'typeLength' };
        return { lines: [...lines, { ...item, qty_step: step, quantity: 0 }], refusal: 'typeLength' };
    }
    if (existing) {
        const quantity = existing.quantity + step;
        if (quantity > MAX_BASE_UNITS) return { lines, refusal: 'quantityRange' };
        return {
            lines: lines.map((l) => (l.package_session_id === item.package_session_id ? { ...l, quantity } : l)),
            refusal: null,
        };
    }
    return { lines: [...lines, { ...item, qty_step: step, quantity: step }], refusal: null };
}

export function setReceiveQuantity(
    lines: ReceiptLineDraft[],
    packageSessionId: string,
    quantity: number | null
): { lines: ReceiptLineDraft[]; refusal: ReceiveRefusal | null } {
    const line = lines.find((l) => l.package_session_id === packageSessionId);
    if (!line) return { lines, refusal: null };
    const piece = (line.stock_mode ?? '').toUpperCase() === 'PIECE';
    if (quantity === null || quantity < 1 || quantity > MAX_BASE_UNITS || (piece && quantity > 200)) {
        return { lines, refusal: 'quantityRange' };
    }
    return {
        lines: lines.map((l) => (l.package_session_id === packageSessionId ? { ...l, quantity } : l)),
        refusal: null,
    };
}

export type ReceiveProblem = 'source' | 'sourcePlace' | 'note' | 'lines' | 'quantities';

/** What still stops Save receipt (null = ready). */
export function receiveProblem(input: {
    source: ReceiveSource | null;
    sourceLocationId: string;
    note: string;
    lines: ReceiptLineDraft[];
}): ReceiveProblem | null {
    if (!input.source) return 'source';
    if (input.source === 'OWN_SOURCE' && !input.sourceLocationId) return 'sourcePlace';
    if (input.source === 'OTHER' && !input.note.trim()) return 'note';
    if (input.lines.length === 0) return 'lines';
    if (input.lines.some((l) => l.quantity < 1)) return 'quantities';
    return null;
}
