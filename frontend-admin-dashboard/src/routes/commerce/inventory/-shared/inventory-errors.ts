import { type OrderError, orderErrorKey, readOrderError } from '@/routes/commerce/orders/-shared/order-errors';

/**
 * Inventory error reading (contract §5, §7.2). The server answers
 * `CODE: sentence`; the codes this module knows map to `inventory.errors.<CODE>`
 * in Hindi and English, everything else falls back to the order desk's
 * reading (guard codes, stock codes, VALIDATION with its sentence).
 */
export const INVENTORY_ERROR_CODES = [
    // New in WP-40.
    'TRANSFER_NOT_FOUND',
    'TRANSFER_SAME_LOCATION',
    'TRANSFER_NOT_DRAFT',
    'TRANSFER_EMPTY',
    'TRANSFER_DISPATCHED',
    'TRANSFER_NOT_DISPATCHED',
    'TRANSFER_NEEDS_DOCUMENT',
    'TRANSFER_DOCUMENT_NOT_ALLOWED',
    'PROMISED_ONLINE',
    'PIECE_NOT_HERE',
    'RECEIVED_ABOVE_SENT',
    'SHORTFALL_REASON_REQUIRED',
    'LOCATION_HAS_TRANSFER_IN_TRANSIT',
    'COUNT_NOT_FOUND',
    'COUNT_ALREADY_OPEN',
    'COUNT_NOT_OPEN',
    'COUNT_OUT_OF_SCOPE',
    'COUNT_TOO_LARGE',
    'RECOUNT_SAME_PERSON',
    'RECOUNT_OPEN',
    'RECOUNT_BLIND',
    'RECOUNT_NOT_FINISHED',
    'LABEL_REQUEST_NOT_FOUND',
    'LABEL_NOT_PENDING',
    'LABEL_NO_PRICE',
    'LABELS_TOO_MANY',
    'EXPORT_TOO_LARGE',
    'CODE_NOT_FOUND',
    // Fix round (reviews of WP-40/41).
    'QTY_REQUIRED',
    'COUNT_NEEDS_RECOUNT',
    'COUNT_LINE_CHANGED',
    'COUNT_LINE_NOT_FOUND',
    'MEASURED_CONFIRM_REQUIRED',
    'RECOUNT_OTHER_PERSON',
    'STOCK_EXISTS',
    'TRANSFER_CHANGED',
    'LOCATION_NOT_FOUND',
    'COUNT_CHANGED',
    // Reused codes the inventory screens meet, worded for them.
    'APPROVAL_REQUIRED',
    'PIN_INVALID',
    'PIN_LOCKED',
    'ITEM_NOT_FOUND',
    'ITEM_UNTRACKED',
    'ITEM_ARCHIVED',
    'LOCATION_NEEDS_GSTIN',
    'SERIES_NOT_CONFIGURED',
    'SERIES_EXHAUSTED',
    'SERIES_PREFIX_IN_USE',
    'RECEIPT_BILLED',
    // WP-53: an opening receipt line with no cost while the switch-over feature is on.
    'OPENING_COST_MISSING',
    // Client side: an earlier send with no answer turned out to be saved under another body.
    'PROBABLY_SAVED',
] as const;

export type InventoryErrorCode = (typeof INVENTORY_ERROR_CODES)[number];

const KNOWN = new Set<string>(INVENTORY_ERROR_CODES);

/** Codes whose server sentence names the item or place and is shown under the mapped one. */
const SHOW_SENTENCE = new Set<string>([
    'PIECE_NOT_HERE',
    'COUNT_ALREADY_OPEN',
    'LOCATION_HAS_TRANSFER_IN_TRANSIT',
    'COUNT_OUT_OF_SCOPE',
    'ITEM_UNTRACKED',
    'ITEM_ARCHIVED',
    'RECEIPT_BILLED',
    'QTY_REQUIRED',
    'COUNT_NEEDS_RECOUNT',
    'MEASURED_CONFIRM_REQUIRED',
    'OPENING_COST_MISSING',
]);

export interface InventoryError extends OrderError {
    /** `inventory.errors.<CODE>` when this module knows the code, else null. */
    invKey: string | null;
    /** No definite answer (network, timeout, 408, 429, 5xx): the same request id must go again. */
    uncertain: boolean;
    /** Values for the sentence's placeholders (`{{sku}}`, `{{count}}`). */
    values: Record<string, string>;
}

export const isUncertainStatus = (status: number | null): boolean =>
    status === null || status === 0 || status === 408 || status === 429 || status >= 500;

const isInventoryError = (value: unknown): value is InventoryError =>
    !!value && typeof value === 'object' && 'invKey' in (value as object) && 'uncertain' in (value as object);

/**
 * `LABEL_NO_PRICE: SKU-1 has no price yet` → `SKU-1`; `PROMISED_ONLINE: 3 unit(s) of SKU-1 …` → 3, SKU-1.
 * A measured item's count is in base units; the server then adds `(qty_scale 10, unit MTR)` (every
 * item it names shares them), read as `qty_scale` and `unit` so the screen says "2.5 m".
 */
function valuesOf(code: string | null, message: string): Record<string, string> {
    if (code === 'LABEL_NO_PRICE') return { sku: /^(\S+)/.exec(message)?.[1] ?? '' };
    if (code === 'PROMISED_ONLINE') {
        const match = /(\d+)\s+unit\S*\s+of\s+(\S+)/i.exec(message);
        const measure = /qty_scale\s+(\d+),\s*unit\s+([A-Za-z]+)/.exec(message);
        return {
            count: match?.[1] ?? '',
            sku: match?.[2] ?? '',
            ...(measure ? { qty_scale: measure[1], unit: measure[2] } : {}),
        };
    }
    return {};
}

export function readInventoryError(error: unknown): InventoryError {
    if (isInventoryError(error)) return error;
    const base = readOrderError(error);
    const known = !!base.code && KNOWN.has(base.code);
    return {
        ...base,
        invKey: known ? `inventory.errors.${base.code}` : null,
        showServerSentence: known ? !!base.message && SHOW_SENTENCE.has(base.code as string) : base.showServerSentence,
        uncertain: isUncertainStatus(base.status) || base.code === 'REQUEST_IN_PROGRESS',
        values: valuesOf(base.code, base.message),
    };
}

/** The i18n key of the sentence to show: the inventory one, else the order desk's. */
export const inventoryErrorKey = (error: InventoryError): string => {
    if (error.invKey) return error.invKey;
    if (error.uncertain && error.status !== null && error.status !== 429) return 'inventory.errors.uncertain';
    return orderErrorKey(error);
};

/** The error shown when an unanswered attempt turns out to be saved under another body. */
export function probablySaved(read: InventoryError): InventoryError {
    return {
        ...read,
        code: 'PROBABLY_SAVED',
        invKey: 'inventory.errors.PROBABLY_SAVED',
        message: '',
        uncertain: false,
        showServerSentence: false,
    };
}
