import type {
    ReceiveTransferBody,
    ShortfallReason,
    TransferLineBody,
    TransferView,
} from './inventory-types';

/**
 * The transfer's lines on screen (contract §7.5), pure and unit-tested:
 * the draft editor at the source and the receive sheet at the destination.
 * Quantities are base units (a metre at `qty_scale` 10 is 10).
 */

/** Why a scan or a typed quantity was not taken; each has `inventory.transferLines.<code>`. */
export const TRANSFER_REFUSALS = [
    'scanPieceLabel',
    'untracked',
    'notHere',
    'alreadyOn',
    'notOnTransfer',
    'allReceived',
    'quantityStep',
    'quantityRange',
    'typeLength',
] as const;
export type TransferRefusal = (typeof TRANSFER_REFUSALS)[number];

export const MAX_BASE_UNITS = 10_000_000;

/** What the draft needs to know about an item (from the picker or a scan). */
export interface DraftItem {
    package_session_id: string;
    sku: string | null;
    product_name: string | null;
    variant_name: string | null;
    stock_mode: string | null;
    stock_policy: string | null;
    unit: string | null;
    qty_scale: number;
    qty_step?: number;
}

export interface DraftLine {
    /** `v:<package session>` or `p:<piece id>`: one line per variant, one per piece. */
    key: string;
    package_session_id: string;
    sku: string | null;
    name: string | null;
    variant_name: string | null;
    unit: string | null;
    qty_scale: number;
    qty_step: number;
    piece_id: string | null;
    piece_code: string | null;
    quantity: number;
}

export interface DraftState {
    fromLocationId: string;
    lines: DraftLine[];
}

export type DraftEvent =
    | { type: 'ADD_VARIANT'; item: DraftItem }
    | {
          type: 'ADD_PIECE';
          item: DraftItem;
          piece: { id: string; code: string; status: string | null; location_id: string | null };
      }
    | { type: 'SET_QUANTITY'; key: string; quantity: number }
    | { type: 'REMOVE'; key: string };

export interface Outcome<S> {
    state: S;
    refusal: TransferRefusal | null;
}

const isPieceItem = (item: DraftItem) => (item.stock_mode ?? '').toUpperCase() === 'PIECE';
/** Cloth by the metre and the like: a length is typed, never added a step at a time. */
const isMeasuredItem = (item: DraftItem) => item.qty_scale > 1 && !isPieceItem(item);
/**
 * The sale step does not apply to stock movements (WP-44 D3): a measured line
 * moves in any whole base unit (a 23.7 m roll at a 0.5 m sale step is 237).
 */
const step = (item: DraftItem) => (isMeasuredItem(item) ? 1 : Math.max(1, Math.floor(item.qty_step ?? 1)));
const isUntracked = (item: DraftItem) => (item.stock_policy ?? '').toUpperCase() === 'UNTRACKED';

/** The draft's lines as the server sent them (variant lines and piece lines). */
export function draftFromView(view: TransferView): DraftState {
    return {
        fromLocationId: view.from?.id ?? '',
        lines: view.lines.map((line) => ({
            key: line.piece_id ? `p:${line.piece_id}` : `v:${line.package_session_id}`,
            package_session_id: line.package_session_id,
            sku: line.sku,
            name: line.item_name,
            variant_name: line.variant_name,
            unit: line.unit,
            qty_scale: line.qty_scale,
            qty_step: 1,
            piece_id: line.piece_id,
            piece_code: line.piece_code,
            quantity: line.qty_sent,
        })),
    };
}

export function applyDraft(state: DraftState, event: DraftEvent): Outcome<DraftState> {
    const refuse = (refusal: TransferRefusal): Outcome<DraftState> => ({ state, refusal });
    switch (event.type) {
        case 'ADD_VARIANT': {
            const { item } = event;
            if (isUntracked(item)) return refuse('untracked');
            if (isPieceItem(item)) return refuse('scanPieceLabel');
            const key = `v:${item.package_session_id}`;
            const existing = state.lines.find((l) => l.key === key);
            // A measured roll: a scan opens its length box (as on receive) instead of adding 0.1 m.
            if (existing && isMeasuredItem(item)) return { state, refusal: 'typeLength' };
            if (existing) {
                const next = existing.quantity + existing.qty_step;
                if (next > MAX_BASE_UNITS) return refuse('quantityRange');
                return {
                    state: { ...state, lines: state.lines.map((l) => (l.key === key ? { ...l, quantity: next } : l)) },
                    refusal: null,
                };
            }
            const line: DraftLine = {
                key,
                package_session_id: item.package_session_id,
                sku: item.sku,
                name: item.product_name,
                variant_name: item.variant_name,
                unit: item.unit,
                qty_scale: item.qty_scale,
                qty_step: step(item),
                piece_id: null,
                piece_code: null,
                quantity: isMeasuredItem(item) ? 0 : step(item),
            };
            return {
                state: { ...state, lines: [...state.lines, line] },
                refusal: isMeasuredItem(item) ? 'typeLength' : null,
            };
        }
        case 'ADD_PIECE': {
            const { piece, item } = event;
            if ((piece.status ?? '').toUpperCase() !== 'IN_STOCK' || piece.location_id !== state.fromLocationId) {
                return refuse('notHere');
            }
            const key = `p:${piece.id}`;
            if (state.lines.some((l) => l.key === key)) return refuse('alreadyOn');
            const line: DraftLine = {
                key,
                package_session_id: item.package_session_id,
                sku: item.sku,
                name: item.product_name,
                variant_name: item.variant_name,
                unit: item.unit,
                qty_scale: item.qty_scale,
                qty_step: 1,
                piece_id: piece.id,
                piece_code: piece.code,
                quantity: 1,
            };
            return { state: { ...state, lines: [...state.lines, line] }, refusal: null };
        }
        case 'SET_QUANTITY': {
            const line = state.lines.find((l) => l.key === event.key);
            if (!line || line.piece_id) return { state, refusal: null };
            const quantity = Math.round(event.quantity);
            if (!Number.isFinite(quantity) || quantity < 1 || quantity > MAX_BASE_UNITS) return refuse('quantityRange');
            if (quantity % line.qty_step !== 0) return refuse('quantityStep');
            return {
                state: { ...state, lines: state.lines.map((l) => (l.key === event.key ? { ...l, quantity } : l)) },
                refusal: null,
            };
        }
        case 'REMOVE':
            return { state: { ...state, lines: state.lines.filter((l) => l.key !== event.key) }, refusal: null };
        default:
            return { state, refusal: null };
    }
}

/** Lines still waiting for a typed length (a scanned roll starts at 0); the draft cannot be saved with them. */
export const linesWithoutLength = (state: DraftState): DraftLine[] =>
    state.lines.filter((line) => !line.piece_id && line.quantity < 1);

/** The draft's lines as the server takes them: every line once, base units. */
export function toTransferLines(state: DraftState): TransferLineBody[] {
    return state.lines.map((line) =>
        line.piece_id ? { piece_id: line.piece_id } : { package_session_id: line.package_session_id, quantity: line.quantity }
    );
}

// ─── Receive sheet ───────────────────────────────────────────────────────────

export interface ReceiveLine {
    line_id: string;
    package_session_id: string;
    piece_code: string | null;
    sent: number;
    received: number;
    reason: ShortfallReason | null;
}

export interface ReceiveState {
    lines: ReceiveLine[];
}

export type ReceiveEvent =
    | { type: 'RECEIVE_SCAN_PIECE'; code: string }
    | { type: 'RECEIVE_SCAN_VARIANT'; packageSessionId: string }
    | { type: 'SET_RECEIVED'; lineId: string; quantity: number }
    | { type: 'SET_REASON'; lineId: string; reason: ShortfallReason | null };

/** Quantity lines start at what was sent, piece lines at 0 (each piece is scanned). */
export function receiveFromView(view: TransferView): ReceiveState {
    return {
        lines: view.lines.map((line) => ({
            line_id: line.id,
            package_session_id: line.package_session_id,
            piece_code: line.piece_code,
            sent: line.qty_sent,
            received: line.piece_id ? 0 : line.qty_sent,
            reason: null,
        })),
    };
}

const withLine = (state: ReceiveState, lineId: string, change: (l: ReceiveLine) => ReceiveLine): ReceiveState => ({
    lines: state.lines.map((l) => (l.line_id === lineId ? change(l) : l)),
});

/** A line received in full needs no reason; the reason is dropped. */
const settleReason = (line: ReceiveLine): ReceiveLine => (line.received >= line.sent ? { ...line, reason: null } : line);

export function applyReceive(state: ReceiveState, event: ReceiveEvent): Outcome<ReceiveState> {
    const refuse = (refusal: TransferRefusal): Outcome<ReceiveState> => ({ state, refusal });
    switch (event.type) {
        case 'RECEIVE_SCAN_PIECE': {
            const code = event.code.trim().toUpperCase();
            const line = state.lines.find((l) => l.piece_code && l.piece_code.toUpperCase() === code);
            if (!line) return refuse('notOnTransfer');
            return { state: withLine(state, line.line_id, (l) => settleReason({ ...l, received: 1 })), refusal: null };
        }
        case 'RECEIVE_SCAN_VARIANT': {
            const line = state.lines.find((l) => !l.piece_code && l.package_session_id === event.packageSessionId);
            if (!line) return refuse('notOnTransfer');
            if (line.received >= line.sent) return refuse('allReceived');
            return {
                state: withLine(state, line.line_id, (l) => settleReason({ ...l, received: l.received + 1 })),
                refusal: null,
            };
        }
        case 'SET_RECEIVED': {
            const line = state.lines.find((l) => l.line_id === event.lineId);
            if (!line) return { state, refusal: null };
            const quantity = Math.round(event.quantity);
            if (!Number.isFinite(quantity) || quantity < 0 || quantity > line.sent) return refuse('quantityRange');
            return { state: withLine(state, event.lineId, (l) => settleReason({ ...l, received: quantity })), refusal: null };
        }
        case 'SET_REASON':
            return { state: withLine(state, event.lineId, (l) => settleReason({ ...l, reason: event.reason })), refusal: null };
        default:
            return { state, refusal: null };
    }
}

/** Short lines that still need "Why is it short?". */
export const linesMissingReason = (state: ReceiveState): ReceiveLine[] =>
    state.lines.filter((l) => l.received < l.sent && !l.reason);

export const canReceive = (state: ReceiveState): boolean => state.lines.length > 0 && linesMissingReason(state).length === 0;

export function toReceiveBody(state: ReceiveState): Omit<ReceiveTransferBody, 'client_request_id' | 'approval'> {
    return {
        lines: state.lines.map((l) => ({
            line_id: l.line_id,
            qty_received: l.received,
            ...(l.received < l.sent && l.reason ? { shortfall_reason: l.reason } : {}),
        })),
    };
}
