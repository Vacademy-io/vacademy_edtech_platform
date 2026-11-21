import {
    type OrderError,
    orderErrorKey,
    readOrderError,
} from '@/routes/commerce/orders/-shared/order-errors';
import { POS_APPROVAL_ACTIONS, type PosApprovalAction } from './pos-types';

/**
 * Billing counter error reading. The server answers `CODE: sentence`; the
 * codes the counter knows map to `pos.errors.<CODE>` (Hindi and English),
 * everything else falls back to the order desk's `orders.errors.*` (which
 * already knows TENDERS_SHORT, PIECE_STATE, the guard codes…), then to its
 * generic sentence.
 */
export const POS_ERROR_CODES = [
    // New with WP-42 (contract §5).
    'REGISTER_NOT_FOUND',
    'REGISTER_CODE_TAKEN',
    'REGISTER_INACTIVE',
    'REGISTER_HAS_OPEN_SESSION',
    'LOCATION_NOT_POS',
    'SESSION_NOT_FOUND',
    'SESSION_ALREADY_OPEN',
    'SESSION_NOT_OPEN',
    'SESSION_NOT_YOURS',
    'OPENING_NOTE_REQUIRED',
    'VARIANCE_NOTE_REQUIRED',
    'COUNT_MISMATCH',
    'APPROVAL_REQUIRED',
    'PRICE_CHANGED',
    'IN_ONLINE_CHECKOUT',
    'CASH_TENDERED_SHORT',
    'CODE_NOT_FOUND',
    'VOID_SESSION_CLOSED',
    'VOID_HAS_RETURNS',
    'VOID_HAS_EXCHANGE',
    'TENDER_STATE_CHANGED',
    'BILL_DATE_INVALID',
    // Reused codes the order desk does not map, worded for the counter.
    'SOLD_ONLINE',
    'NOT_IN_STOCK',
    'CART_CHANGED',
    'NOT_PRICEABLE',
    'SERIES_NOT_CONFIGURED',
    'SERIES_EXHAUSTED',
    'SERIES_PREFIX_IN_USE',
    'BILL_BOOK_NOT_REGISTERED',
    'BILL_BOOK_NUMBER_USED',
    'EXCHANGE_NOT_AVAILABLE',
    'EXCHANGE_REMAINDER_REQUIRED',
    'PIN_INVALID',
    'PIN_LOCKED',
    // POS review follow-ups (D5): a void or payment change from another counter's drawer.
    'SESSION_MISMATCH',
    // WP-44 (B7): a length that is not on the sale step ("line l1 is sold in steps of 0.5 m").
    'QUANTITY_STEP',
    // Screen-side, not a server code: a write whose answer never came was saved under another body.
    'PROBABLY_SAVED',
] as const;

export type PosErrorCode = (typeof POS_ERROR_CODES)[number];

const KNOWN = new Set<string>(POS_ERROR_CODES);
const ACTIONS = new Set<string>(POS_APPROVAL_ACTIONS);

/** Stock refusals shown on the bill line they name. */
export const LINE_STOCK_CODES: ReadonlySet<string> = new Set([
    'SOLD_ONLINE',
    'IN_ONLINE_CHECKOUT',
    'NOT_IN_STOCK',
    'PIECE_STATE',
]);

/** Codes after which the bill must be priced again (the dialog closes). */
export const REQUOTE_CODES: ReadonlySet<string> = new Set(['PRICE_CHANGED', 'CART_CHANGED']);

export interface PosError extends OrderError {
    /** `pos.errors.<CODE>` when the counter maps the code, else null. */
    posKey: string | null;
    /** `HH:MM` named in an IN_ONLINE_CHECKOUT sentence. */
    time: string | null;
    /** The bill line the sentence names (`line l2 …`). */
    lineRef: string | null;
    /** The approval an APPROVAL_REQUIRED asks for. */
    action: PosApprovalAction | null;
    /**
     * The server may or may not have saved the write: no answer (offline, timeout), 408, 429, any 5xx
     * (a gateway 502/503/504 can come after the commit) or a request still in progress. The same
     * request id must go again.
     */
    uncertain: boolean;
    /** Same as `uncertain`: the screen says "Not sure it was saved. Retry". */
    network: boolean;
}

/** Statuses after which the server may or may not have saved the write. */
export const isUncertainStatus = (status: number | null): boolean =>
    status === null || status === 0 || status === 408 || status === 429 || status >= 500;

/** A 409 that means "the first request with this id is still running". */
const IN_PROGRESS_CODES: ReadonlySet<string> = new Set(['REQUEST_IN_PROGRESS']);

const TIME = /\b(\d{1,2}:\d{2})\b/;
const LINE_REF = /\bline\s+(l\d+)\b/i;

/** `APPROVAL_REQUIRED: POS_DISCOUNT …` → POS_DISCOUNT; null for anything else. */
export function approvalActionOf(error: unknown): PosApprovalAction | null {
    const read = isPosError(error) ? error : readOrderError(error);
    if (read.code !== 'APPROVAL_REQUIRED') return null;
    const first = read.message.split(/[\s:,.]+/)[0] ?? '';
    return ACTIONS.has(first) ? (first as PosApprovalAction) : null;
}

const isPosError = (value: unknown): value is PosError =>
    !!value && typeof value === 'object' && 'posKey' in (value as object) && 'uncertain' in (value as object);

export function readPosError(error: unknown): PosError {
    if (isPosError(error)) return error;
    const base = readOrderError(error);
    const code = base.code;
    const time = code === 'IN_ONLINE_CHECKOUT' ? (TIME.exec(base.message)?.[1] ?? null) : null;
    const amount =
        code === 'PRICE_CHANGED' ? (/(\d[\d,]*\.\d{1,2})/.exec(base.message)?.[1]?.replace(/,/g, '') ?? null) : base.amount;
    const read: PosError = {
        ...base,
        amount,
        posKey: code && KNOWN.has(code) ? `pos.errors.${code}` : null,
        time,
        lineRef: LINE_REF.exec(base.message)?.[1] ?? null,
        action: null,
        uncertain: false,
        network: false,
    };
    read.uncertain = isUncertainStatus(base.status) || (!!code && IN_PROGRESS_CODES.has(code));
    read.network = read.uncertain;
    read.action = approvalActionOf(read);
    return read;
}

/** The i18n key of the sentence to show: the counter's, else the order desk's. */
export const posErrorKey = (error: PosError): string => error.posKey ?? orderErrorKey(error);

/** Show the server's own sentence under the mapped one (it names the field or line). */
export const showPosServerSentence = (error: PosError): boolean =>
    !!error.message &&
    (error.code === 'VALIDATION' ||
        error.code === 'SESSION_ALREADY_OPEN' ||
        error.code === 'QUANTITY_STEP' ||
        (!error.posKey && error.showServerSentence));
