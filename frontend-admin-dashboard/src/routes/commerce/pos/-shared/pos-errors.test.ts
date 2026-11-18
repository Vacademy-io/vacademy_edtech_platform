/** Contract §8.3: every counter code maps; unknown codes fall back to the order desk's reading. */
import { describe, expect, it } from 'vitest';
import { POS_ERROR_CODES, approvalActionOf, posErrorKey, readPosError } from './pos-errors';
import { networkError, serverError } from './pos-test-fixtures';

describe('pos errors', () => {
    it.each(POS_ERROR_CODES)('%s maps to pos.errors.%s', (code) => {
        const read = readPosError(serverError(409, `${code}: something happened`));
        expect(read.code).toBe(code);
        expect(read.posKey).toBe(`pos.errors.${code}`);
        expect(posErrorKey(read)).toBe(`pos.errors.${code}`);
    });

    it('an order desk code falls back to orders.errors.*', () => {
        const read = readPosError(serverError(409, 'TENDERS_SHORT: 50.00 is not paid'));
        expect(read.posKey).toBeNull();
        expect(posErrorKey(read)).toBe('orders.errors.TENDERS_SHORT');
        expect(read.amount).toBe('50.00');
    });

    it('an unknown code falls back to the generic sentence', () => {
        expect(posErrorKey(readPosError(serverError(409, 'SOMETHING_NEW: x')))).toBe('orders.errors.generic');
    });

    it('reads the time, the line and the new price', () => {
        const busy = readPosError(serverError(409, 'IN_ONLINE_CHECKOUT: BTL-1 is in an online checkout until 14:35'));
        expect(busy.time).toBe('14:35');
        const price = readPosError(serverError(409, 'PRICE_CHANGED: line l2 is now 499.00'));
        expect(price.lineRef).toBe('l2');
        expect(price.amount).toBe('499.00');
    });

    it('approvalActionOf parses the action of APPROVAL_REQUIRED', () => {
        expect(approvalActionOf(serverError(409, 'APPROVAL_REQUIRED: POS_DISCOUNT discount above 5%'))).toBe('POS_DISCOUNT');
        expect(approvalActionOf(serverError(409, 'APPROVAL_REQUIRED: POS_VARIANCE'))).toBe('POS_VARIANCE');
        expect(readPosError(serverError(409, 'APPROVAL_REQUIRED: POS_VOID')).action).toBe('POS_VOID');
        expect(approvalActionOf(serverError(409, 'APPROVAL_REQUIRED: SOMETHING'))).toBeNull();
        expect(approvalActionOf(serverError(409, 'SESSION_NOT_OPEN: closed'))).toBeNull();
    });

    it('no answer at all reads as a network failure (same request may be sent again)', () => {
        const read = readPosError(networkError());
        expect(read.network).toBe(true);
        expect(readPosError(serverError(409, 'SOLD_ONLINE: x')).network).toBe(false);
    });

    it('a gateway error, 408, 429 or any 5xx is uncertain too: the server may have saved it', () => {
        [0, 408, 429, 500, 502, 503, 504].forEach((status) => {
            const read = readPosError(serverError(status, 'Bad Gateway'));
            expect(read.uncertain).toBe(true);
            expect(read.network).toBe(true);
        });
        [400, 403, 404, 409, 422].forEach((status) =>
            expect(readPosError(serverError(status, 'VALIDATION: x')).uncertain).toBe(false)
        );
    });

    it('maps SESSION_MISMATCH (void or payment change from another counter session)', () => {
        const read = readPosError(serverError(409, 'SESSION_MISMATCH: this bill was made at another counter session'));
        expect(read.posKey).toBe('pos.errors.SESSION_MISMATCH');
        expect(read.uncertain).toBe(false);
    });
});
