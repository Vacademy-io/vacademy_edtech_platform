/** F5: reading the server's `CODE: sentence` errors. */
import { AxiosError } from 'axios';
import { describe, expect, it } from 'vitest';
import { readCommerceError } from '@/routes/commerce/-shared/commerce-errors';
import { ORDER_ERROR_CODES, orderErrorKey, orderErrorKind, readOrderError } from './order-errors';

const failure = (status: number, message: string, headers: Record<string, string> = {}) =>
    new AxiosError('failed', 'ERR_BAD_RESPONSE', undefined, undefined, {
        status,
        data: { message },
        headers,
        statusText: '',
        config: {} as never,
    } as never);

describe('readOrderError', () => {
    it('splits upper- and lower-case codes from the sentence', () => {
        const upper = readOrderError(failure(409, 'ORDER_STATE_CHANGED: the order moved on'));
        expect(upper).toMatchObject({
            status: 409,
            code: 'ORDER_STATE_CHANGED',
            key: 'orders.errors.ORDER_STATE_CHANGED',
            message: 'the order moved on',
            showServerSentence: false,
        });
        const lower = readOrderError(failure(400, 'invalid_request: subject is too long'));
        expect(lower).toMatchObject({ code: 'invalid_request', key: null, message: 'subject is too long', showServerSentence: true });
    });

    it('maps every listed code to its key', () => {
        ORDER_ERROR_CODES.forEach((code) => {
            expect(readOrderError(failure(409, `${code}: x`)).key).toBe(`orders.errors.${code}`);
        });
    });

    it('an unknown code keeps the server sentence', () => {
        const error = readOrderError(failure(409, 'SOMETHING_NEW: the server explains'));
        expect(error.key).toBeNull();
        expect(error.showServerSentence).toBe(true);
        expect(orderErrorKey(error)).toBe('orders.errors.generic');
    });

    it('a plain sentence is not a code', () => {
        expect(readOrderError(failure(400, 'Note: something')).code).toBeNull();
    });

    it('extracts the amount for the money codes', () => {
        expect(readOrderError(failure(409, 'RECEIPT_ABOVE_DUE: only 1,250.50 is due')).amount).toBe('1250.50');
        expect(readOrderError(failure(400, 'TENDERS_SHORT: payments 300.00 are less than the total 800.00')).amount).toBe('300.00');
        expect(readOrderError(failure(409, 'REFUND_ABOVE_PAID: only 50 of the payment can be refunded')).amount).toBe('50');
        expect(readOrderError(failure(409, 'REFUND_ABOVE_DUE: 120.00 is due back to the customer')).amount).toBe('120.00');
        expect(readOrderError(failure(409, 'ORDER_STATE_CHANGED: line 2 moved')).amount).toBeNull();
    });

    it('status, Retry-After and kinds', () => {
        const limited = readOrderError(failure(429, 'too many', { 'retry-after': '125' }));
        expect(limited.code).toBe('rate_limited');
        expect(limited.retryAfterSeconds).toBe(125);
        expect(orderErrorKind(readOrderError(failure(403, 'LOCATION_NOT_ALLOWED: not here')))).toBe('access');
        expect(orderErrorKind(readOrderError(failure(403, 'FEATURE_DISABLED: off')))).toBe('feature');
        expect(orderErrorKind(readOrderError(failure(409, 'SHIPMENT_STATE_CHANGED: x')))).toBe('state');
        expect(orderErrorKind(readOrderError(failure(409, 'IDEMPOTENCY_MISMATCH: x')))).toBe('idempotency');
        expect(orderErrorKind(readOrderError(failure(409, 'PIECE_SCAN_REQUIRED: line 1')))).toBe('inline');
        const network = readOrderError(new AxiosError('Network Error', 'ERR_NETWORK'));
        expect(network.status).toBeNull();
        expect(orderErrorKind(network)).toBe('network');
        expect(orderErrorKey(network)).toBe('orders.errors.network');
    });
});

/** A failed call whose body is whatever the server (or a proxy) sent. */
const failureWithBody = (status: number, data: unknown) =>
    new AxiosError('failed', 'ERR_BAD_RESPONSE', undefined, undefined, {
        status,
        data,
        headers: {},
        statusText: '',
        config: {} as never,
    } as never);

describe('unexpected error bodies', () => {
    it.each([
        ['an object message', { message: { detail: 'x' } }],
        ['a number message', { message: 123 }],
        ['an array ex', { ex: ['x'] }],
        ['a number message and object ex', { message: 5, ex: { a: 1 } }],
        ['an HTML page', '<html>Bad gateway</html>'],
        ['null', null],
    ])('%s: no crash, no sentence, the generic text', (_name, data) => {
        const error = readOrderError(failureWithBody(500, data));
        expect(error).toMatchObject({ status: 500, code: null, key: null, message: '' });
        expect(orderErrorKey(error)).toBe('orders.errors.generic');
        expect(() => readCommerceError(failureWithBody(500, data), 'fallback')).not.toThrow();
        expect(readCommerceError(failureWithBody(500, data), 'fallback')).toEqual({ code: null, message: 'fallback' });
    });

    it('a text ex is still read when message is not text', () => {
        expect(readOrderError(failureWithBody(409, { message: 7, ex: 'ORDER_STATE_CHANGED: moved' })).code).toBe(
            'ORDER_STATE_CHANGED'
        );
    });
});

describe('a 403 without a code', () => {
    it('reads as "no access here", not "something went wrong"', () => {
        const bare = readOrderError(failureWithBody(403, { message: 'Forbidden' }));
        expect(bare.key).toBeNull();
        expect(orderErrorKind(bare)).toBe('access');
        expect(orderErrorKey(bare)).toBe('orders.errors.ACCESS_DENIED');
        expect(orderErrorKey(readOrderError(failureWithBody(403, null)))).toBe('orders.errors.ACCESS_DENIED');
    });

    it('a 403 with a known code keeps its own sentence', () => {
        expect(orderErrorKey(readOrderError(failure(403, 'LOCATION_NOT_ALLOWED: not here')))).toBe(
            'orders.errors.LOCATION_NOT_ALLOWED'
        );
    });
});
