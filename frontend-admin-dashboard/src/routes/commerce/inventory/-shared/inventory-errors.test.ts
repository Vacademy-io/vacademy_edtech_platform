/** Contract §8.3: every inventory code maps to a sentence; anything else falls back to the order desk's reading. */
import { AxiosError, type AxiosResponse } from 'axios';
import { describe, expect, it } from 'vitest';
import { INVENTORY_ERROR_CODES, inventoryErrorKey, probablySaved, readInventoryError } from './inventory-errors';

const serverError = (status: number, message: string) =>
    new AxiosError(message, String(status), undefined, undefined, {
        status,
        data: { message },
        headers: {},
        statusText: 'x',
        config: {},
    } as unknown as AxiosResponse);

describe('readInventoryError', () => {
    it.each(INVENTORY_ERROR_CODES.filter((c) => c !== 'PROBABLY_SAVED'))('%s maps to its sentence', (code) => {
        const read = readInventoryError(serverError(409, `${code}: something happened`));
        expect(read.code).toBe(code);
        expect(inventoryErrorKey(read)).toBe(`inventory.errors.${code}`);
    });

    it('takes the SKU of LABEL_NO_PRICE and the units of PROMISED_ONLINE', () => {
        expect(readInventoryError(serverError(409, 'LABEL_NO_PRICE: SCARF-1 has no price yet')).values).toEqual({ sku: 'SCARF-1' });
        expect(
            readInventoryError(serverError(409, 'PROMISED_ONLINE: 3 unit(s) of BOTTLE-1 are held or sold online')).values
        ).toEqual({ count: '3', sku: 'BOTTLE-1' });
    });

    it('falls back to the order desk for other codes and keeps the server sentence where it names something', () => {
        const read = readInventoryError(serverError(409, 'NOT_IN_STOCK: BOTTLE-1 has 2 at WH1'));
        expect(read.invKey).toBeNull();
        expect(inventoryErrorKey(read)).toBe('orders.errors.NOT_IN_STOCK');
        const unknown = readInventoryError(serverError(400, 'SOMETHING_NEW: a sentence'));
        expect(inventoryErrorKey(unknown)).toBe('orders.errors.generic');
        expect(unknown.showServerSentence).toBe(true);
    });

    it('no answer or a gateway error is uncertain (same request id again); a 4xx is not', () => {
        expect(readInventoryError(new AxiosError('Network Error', 'ERR_NETWORK')).uncertain).toBe(true);
        expect(readInventoryError(serverError(502, 'Bad gateway')).uncertain).toBe(true);
        expect(inventoryErrorKey(readInventoryError(serverError(503, '')))).toBe('inventory.errors.uncertain');
        expect(readInventoryError(serverError(403, 'APPROVAL_REQUIRED: STOCK_ADJUSTMENT above the limit')).uncertain).toBe(false);
    });

    it('a probably saved write says so', () => {
        const read = probablySaved(readInventoryError(serverError(409, 'IDEMPOTENCY_MISMATCH: x')));
        expect(inventoryErrorKey(read)).toBe('inventory.errors.PROBABLY_SAVED');
    });
});
