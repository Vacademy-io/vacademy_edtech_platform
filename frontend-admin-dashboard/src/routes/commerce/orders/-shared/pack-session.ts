import { itemLines, openQuantity } from './order-actions';
import type { PackBody, ScanResult, StaffOrderDetail } from './order-types';

/**
 * The pack station's state (contract §5.3.3), as a pure reducer. The server only
 * checks quantities and piece ids, so a wrong item is refused here, before the
 * Pack call: a piece already scanned, a piece not in stock or at another
 * location, a product that is not in the order, more than the order needs, or a
 * product label where the item is one-of-a-kind.
 *
 * Without the B1 fields (`stock_mode`, `stock_policy`) a line starts UNKNOWN and
 * learns its mode from the scans or from the server's 409 PIECE_SCAN_REQUIRED.
 */

export type PackMode = 'PIECE' | 'QUANTITY' | 'UNKNOWN';

export const PACK_REFUSALS = [
    'alreadyScanned',
    'pieceNotInStock',
    'pieceElsewhere',
    'notInOrder',
    'enoughAlready',
    'scanPieceLabel',
    'codeNotFound',
    'tickNotAllowed',
] as const;
export type PackRefusal = (typeof PACK_REFUSALS)[number];

export interface PackLine {
    lineId: string;
    lineNo: number;
    packageSessionId: string | null;
    name: string;
    variantLabel: string | null;
    sku: string | null;
    unit: string | null;
    /** Open quantity: quantity − cancelled − shipped (stored integer). */
    needed: number;
    qtyScale: number;
    mode: PackMode;
    packed: number;
    pieceCodes: string[];
    pieceIds: string[];
}

export type PackOutcome =
    | { ok: true; lineId: string; seq: number }
    | { ok: false; refusal: PackRefusal; status?: string; seq: number };

export interface PackSession {
    orderId: string;
    /** The order's fulfilment location; a piece elsewhere is refused. */
    locationId: string | null;
    lines: PackLine[];
    /** Scanning is off (no `commerce.stock`): every line may be ticked. */
    scanUnavailable: boolean;
    last: PackOutcome | null;
}

export type PackEvent =
    | { type: 'SCAN_RESULT'; result: ScanResult }
    | { type: 'SCAN_NOT_FOUND' }
    | { type: 'TICK'; lineId: string }
    | { type: 'UNTICK'; lineId: string }
    | { type: 'REMOVE_PIECE'; code: string }
    | { type: 'SERVER_PIECE_SCAN_REQUIRED'; lineNo: number }
    | { type: 'SERVER_PIECE_NOT_AVAILABLE'; code?: string | null }
    | { type: 'SCAN_UNAVAILABLE' };

const modeOf = (stockMode?: string | null, stockPolicy?: string | null): PackMode => {
    if (!stockMode && !stockPolicy) return 'UNKNOWN';
    return (stockMode ?? '').toUpperCase() === 'PIECE' && (stockPolicy ?? '').toUpperCase() === 'TRACKED'
        ? 'PIECE'
        : 'QUANTITY';
};

export function initPackSession(detail: StaffOrderDetail): PackSession {
    return {
        orderId: detail.order.id,
        locationId: detail.fulfilment_location_id ?? null,
        scanUnavailable: false,
        last: null,
        lines: itemLines(detail)
            .map((line): PackLine => ({
                lineId: line.id,
                lineNo: line.line_no,
                packageSessionId: line.package_session_id,
                name: line.name ?? line.sku ?? '',
                variantLabel: line.variant_label,
                sku: line.sku,
                unit: line.unit,
                needed: openQuantity(line),
                qtyScale: line.qty_scale > 1 ? line.qty_scale : 1,
                mode: modeOf(line.stock_mode, line.stock_policy),
                packed: 0,
                pieceCodes: [],
                pieceIds: [],
            }))
            .filter((line) => line.needed > 0),
    };
}

const nextSeq = (state: PackSession) => (state.last?.seq ?? 0) + 1;

const refuse = (state: PackSession, refusal: PackRefusal, status?: string): PackSession => ({
    ...state,
    last: { ok: false, refusal, status, seq: nextSeq(state) },
});

const update = (state: PackSession, lineId: string, change: (line: PackLine) => PackLine, accepted = true): PackSession => ({
    ...state,
    lines: state.lines.map((line) => (line.lineId === lineId ? change(line) : line)),
    last: accepted ? { ok: true, lineId, seq: nextSeq(state) } : state.last,
});

const isFull = (line: PackLine) => line.packed >= line.needed;

function scanPiece(state: PackSession, result: ScanResult): PackSession {
    const piece = result.piece;
    if (!piece) return refuse(state, 'codeNotFound');
    const code = piece.code.toUpperCase();
    if (state.lines.some((line) => line.pieceCodes.some((c) => c.toUpperCase() === code))) {
        return refuse(state, 'alreadyScanned');
    }
    if (piece.status && piece.status.toUpperCase() !== 'IN_STOCK') {
        return refuse(state, 'pieceNotInStock', piece.status);
    }
    if (piece.location_id && state.locationId && piece.location_id !== state.locationId) {
        return refuse(state, 'pieceElsewhere');
    }
    const matching = state.lines.filter(
        (line) => line.packageSessionId === result.variant.package_session_id
    );
    if (matching.length === 0) return refuse(state, 'notInOrder');
    const target = matching.find((line) => !isFull(line));
    if (!target) return refuse(state, 'enoughAlready');
    if (target.mode === 'QUANTITY') {
        // A piece label on a quantity item is still that item: one unit, no code sent.
        return update(state, target.lineId, (line) => ({ ...line, packed: line.packed + 1 }));
    }
    return update(state, target.lineId, (line) => ({
        ...line,
        mode: 'PIECE',
        packed: line.pieceCodes.length + 1,
        pieceCodes: [...line.pieceCodes, piece.code],
        pieceIds: [...line.pieceIds, piece.id],
    }));
}

function scanVariant(state: PackSession, result: ScanResult): PackSession {
    const variant = result.variant;
    const matching = state.lines.filter((line) => line.packageSessionId === variant.package_session_id);
    if (matching.length === 0) return refuse(state, 'notInOrder');
    const variantIsPiece = modeOf(variant.stock_mode, variant.stock_policy) === 'PIECE';
    if (variantIsPiece && !state.scanUnavailable) {
        // The scan answer itself says one-of-a-kind: learn it and ask for the piece label.
        const learned: PackSession = {
            ...state,
            lines: state.lines.map((line) =>
                matching.includes(line) && line.mode === 'UNKNOWN'
                    ? { ...line, mode: 'PIECE', packed: line.pieceCodes.length }
                    : line
            ),
        };
        return refuse(learned, 'scanPieceLabel');
    }
    const counted = matching.filter((line) => line.mode !== 'PIECE');
    if (counted.length === 0) return refuse(state, 'scanPieceLabel');
    const target = counted.find((line) => !isFull(line));
    if (!target) return refuse(state, 'enoughAlready');
    if (target.qtyScale > 1) {
        // Sold by length: one scan confirms the cut.
        return update(state, target.lineId, (line) => ({
            ...line,
            mode: line.mode === 'UNKNOWN' ? 'QUANTITY' : line.mode,
            packed: line.needed,
        }));
    }
    return update(state, target.lineId, (line) => ({
        ...line,
        mode: line.mode === 'UNKNOWN' ? 'QUANTITY' : line.mode,
        packed: line.packed + 1,
    }));
}

export function packReducer(state: PackSession, event: PackEvent): PackSession {
    switch (event.type) {
        case 'SCAN_RESULT':
            return event.result.kind === 'PIECE' ? scanPiece(state, event.result) : scanVariant(state, event.result);
        case 'SCAN_NOT_FOUND':
            return refuse(state, 'codeNotFound');
        case 'TICK': {
            const line = state.lines.find((l) => l.lineId === event.lineId);
            if (!line) return state;
            if (line.mode === 'PIECE' && !state.scanUnavailable) return refuse(state, 'tickNotAllowed');
            return update(state, event.lineId, (l) => ({ ...l, packed: l.needed }));
        }
        case 'UNTICK':
            return update(
                state,
                event.lineId,
                (line) => ({ ...line, packed: line.mode === 'PIECE' ? line.pieceCodes.length : 0 }),
                false
            );
        case 'REMOVE_PIECE': {
            const code = event.code.toUpperCase();
            const owner = state.lines.find((line) => line.pieceCodes.some((c) => c.toUpperCase() === code));
            if (!owner) return state;
            return update(
                state,
                owner.lineId,
                (line) => {
                    const index = line.pieceCodes.findIndex((c) => c.toUpperCase() === code);
                    const pieceCodes = line.pieceCodes.filter((_, i) => i !== index);
                    const pieceIds = line.pieceIds.filter((_, i) => i !== index);
                    return { ...line, pieceCodes, pieceIds, packed: Math.max(0, line.packed - 1) };
                },
                false
            );
        }
        case 'SERVER_PIECE_SCAN_REQUIRED':
            return {
                ...state,
                lines: state.lines.map((line) =>
                    line.lineNo === event.lineNo
                        ? { ...line, mode: 'PIECE', packed: line.pieceCodes.length }
                        : line
                ),
            };
        case 'SERVER_PIECE_NOT_AVAILABLE':
            return event.code ? packReducer(state, { type: 'REMOVE_PIECE', code: event.code }) : state;
        case 'SCAN_UNAVAILABLE':
            return { ...state, scanUnavailable: true };
        default:
            return state;
    }
}

/** Every line packed in full, and one-of-a-kind lines have a piece per unit. */
export function isComplete(state: PackSession): boolean {
    return (
        state.lines.length > 0 &&
        state.lines.every(
            (line) =>
                line.packed === line.needed &&
                (line.mode !== 'PIECE' || state.scanUnavailable || line.pieceCodes.length === line.needed)
        )
    );
}

/** `POST /shipments`: open quantities; piece codes only for piece lines. */
export function toPackRequest(state: PackSession, clientRequestId: string, weightGrams?: number): PackBody {
    return {
        client_request_id: clientRequestId,
        order_id: state.orderId,
        from_status: 'CONFIRMED',
        lines: state.lines.map((line) =>
            line.mode === 'PIECE' && line.pieceCodes.length > 0
                ? { order_line_id: line.lineId, quantity: line.needed, piece_codes: [...line.pieceCodes] }
                : { order_line_id: line.lineId, quantity: line.needed }
        ),
        ...(weightGrams ? { weight_grams: weightGrams } : {}),
    };
}

/** `PIECE_SCAN_REQUIRED: line 2 …` → 2. */
export function lineNoFromServer(sentence: string): number | null {
    const match = /\bline\s+(\d+)/i.exec(sentence);
    return match ? Number(match[1]) : null;
}

/** A piece code named in a 409 sentence (labels look like `P-…`), if any. */
export function pieceCodeFromServer(sentence: string, known: readonly string[]): string | null {
    const upper = sentence.toUpperCase();
    return known.find((code) => upper.includes(code.toUpperCase())) ?? null;
}
