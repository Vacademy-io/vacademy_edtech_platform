import { AxiosError } from 'axios';
import { getBackendErrorBody } from '@/lib/report-api-error';
import { readCommerceError } from '@/routes/commerce/-shared/commerce-errors';

/**
 * Order desk error reading. The server answers `CODE: sentence` in `message`
 * (or `ex`); the desk maps the codes it knows to a Hindi/English sentence under
 * `orders.errors.<CODE>` and keeps the server's English sentence for the cases
 * where it names the field, line or order.
 *
 * Wraps `readCommerceError` (the six guard codes) rather than replacing it.
 */
export const ORDER_ERROR_CODES = [
    'ORDER_STATE_CHANGED',
    'SHIPMENT_STATE_CHANGED',
    'ORDER_TRANSITION_NOT_ALLOWED',
    'ORDER_NOT_FOUND',
    'NOT_FULLY_PACKED',
    'PIECE_SCAN_REQUIRED',
    'PIECE_NOT_AVAILABLE',
    'PIECE_STATE',
    'LOCATION_NOT_ONLINE',
    'NO_FULFILMENT_LOCATION',
    'STOCK_NOT_SETTLED',
    'NOT_IN_STOCK',
    'COD_COLLECTED',
    'HAS_RETURNS',
    'LINE_NOT_CANCELLABLE',
    'RECEIPT_ABOVE_DUE',
    'USE_COD_REMITTANCE',
    'REMITTANCE_ORDER_NOT_DUE',
    'REMITTANCE_REFERENCE_REUSED',
    'REMITTANCE_DIFFERENCE_REASON_REQUIRED',
    'REMITTANCE_NOT_FOUND',
    'IDEMPOTENCY_MISMATCH',
    'TAX_NOT_CONFIGURED',
    'SELLER_GSTIN_MISSING',
    'TAX_SNAPSHOT_STALE',
    'INVOICE_FULLY_CREDITED',
    'INVOICE_MISSING',
    'PERIOD_LOCKED',
    'RTO_LINES_INCOMPLETE',
    'TENDERS_SHORT',
    'TENDERS_OVER',
    'REFUND_ABOVE_DUE',
    'REFUND_ABOVE_PAID',
    'REFUND_ABOVE_RETURN',
    'REFUND_METHOD_NOT_AVAILABLE',
    'GATEWAY_PAYMENT_UNKNOWN',
    'GATEWAY_REFUND_MISMATCH',
    'REFUND_STATE_CHANGED',
    'REFUND_NOT_FOUND',
    'USE_EXCHANGE_ORDER',
    'ORDER_NOT_RETURNABLE',
    'ORDER_NOT_PAID',
    'RETURN_QTY_EXCEEDED',
    'RETURN_POLICY_WARNING',
    'RETURN_STATE_CHANGED',
    'RETURN_LINES_INCOMPLETE',
    'RETURN_NOT_FOUND',
    'LOCATION_INACTIVE',
    'SETTING_VERSION_CONFLICT',
    'LINK_BASE_NOT_VERIFIED',
    'NO_TEST_CONTACT',
    'rate_limited',
    'ROLE_NOT_ALLOWED',
    'LOCATION_NOT_ALLOWED',
    'ACCESS_DENIED',
    'FEATURE_DISABLED',
] as const;

export type OrderErrorCode = (typeof ORDER_ERROR_CODES)[number];

/** Keys every error falls back to; listed for the locales test. */
export const ORDER_ERROR_FALLBACK_KEYS = ['generic', 'network'] as const;

/** Someone else moved the thing on: toast, refetch, close the dialog. */
export const STATE_CODES: ReadonlySet<string> = new Set([
    'ORDER_STATE_CHANGED',
    'SHIPMENT_STATE_CHANGED',
    'RETURN_STATE_CHANGED',
    'REFUND_STATE_CHANGED',
    'ORDER_TRANSITION_NOT_ALLOWED',
    'SETTING_VERSION_CONFLICT',
]);

const ACCESS_CODES: ReadonlySet<string> = new Set([
    'ROLE_NOT_ALLOWED',
    'LOCATION_NOT_ALLOWED',
    'ACCESS_DENIED',
]);

/** Codes whose sentence carries an amount the mapped sentence repeats. */
const AMOUNT_CODES: ReadonlySet<string> = new Set([
    'REFUND_ABOVE_DUE',
    'REFUND_ABOVE_PAID',
    'REFUND_ABOVE_RETURN',
    'RECEIPT_ABOVE_DUE',
    'TENDERS_SHORT',
    'TENDERS_OVER',
]);

/** Codes whose server sentence is shown under the mapped one (it names the field). */
const SHOW_SERVER_SENTENCE: ReadonlySet<string> = new Set(['VALIDATION', 'invalid_request']);

export interface OrderError {
    status: number | null;
    code: string | null;
    /** `orders.errors.<CODE>` when the code is mapped; else null. */
    key: string | null;
    /** The first number in the sentence, for the codes that carry an amount. */
    amount: string | null;
    /** The server sentence without its code; empty when the server said nothing. */
    message: string;
    /** Seconds from `Retry-After` (429). */
    retryAfterSeconds: number | null;
    /** The server's sentence should be shown under the mapped one. */
    showServerSentence: boolean;
}

export type OrderErrorKind = 'feature' | 'access' | 'state' | 'idempotency' | 'network' | 'inline';

const CODE_PREFIX = /^([A-Za-z_]+):\s*([\s\S]*)$/;
const FIRST_AMOUNT = /\d[\d,]*(?:\.\d+)?/;
const KNOWN = new Set<string>(ORDER_ERROR_CODES);

/** Codes are UPPER_SNAKE or lower_snake; "Note: …" is a sentence, not a code. */
const looksLikeCode = (word: string) => /^[A-Z][A-Z0-9_]*$/.test(word) || /^[a-z]+_[a-z_]+$/.test(word);

export function readOrderError(error: unknown): OrderError {
    const isAxios = error instanceof AxiosError;
    const status = isAxios ? (error.response?.status ?? null) : null;
    const body = getBackendErrorBody(error);
    const raw = (body?.message || body?.ex || '').trim();
    const guard = readCommerceError(error, '');

    let code: string | null = guard.code;
    let message = raw;
    const match = CODE_PREFIX.exec(raw);
    if (match && match[1] && looksLikeCode(match[1])) {
        code = match[1];
        message = (match[2] ?? '').trim();
    }
    if (!code && status === 429) code = 'rate_limited';

    const retryHeader = isAxios ? error.response?.headers?.['retry-after'] : undefined;
    const retry = Number(retryHeader);
    const amountMatch = code && AMOUNT_CODES.has(code) ? FIRST_AMOUNT.exec(message) : null;

    return {
        status,
        code,
        key: code && KNOWN.has(code) ? `orders.errors.${code}` : null,
        amount: amountMatch ? amountMatch[0].replace(/,/g, '') : null,
        message,
        retryAfterSeconds: Number.isFinite(retry) && retry > 0 ? retry : null,
        showServerSentence:
            !!message && (!code || !KNOWN.has(code) || SHOW_SERVER_SENTENCE.has(code)),
    };
}

/** How a screen reacts to the error (contract §4). */
export function orderErrorKind(error: OrderError): OrderErrorKind {
    if (error.code === 'FEATURE_DISABLED') return 'feature';
    if ((error.code && ACCESS_CODES.has(error.code)) || error.status === 403) return 'access';
    if (error.code && STATE_CODES.has(error.code)) return 'state';
    if (error.code === 'IDEMPOTENCY_MISMATCH') return 'idempotency';
    if (error.status === null) return 'network';
    return 'inline';
}

/** The i18n key of the main sentence for an error (mapped, network, or generic). */
export function orderErrorKey(error: OrderError): string {
    if (error.key) return error.key;
    if (error.status === null && !error.message) return 'orders.errors.network';
    return 'orders.errors.generic';
}
