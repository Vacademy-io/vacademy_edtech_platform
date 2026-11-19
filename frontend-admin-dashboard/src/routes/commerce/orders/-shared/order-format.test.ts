/** WP-44 FA1: quantities print the unit sign and drop trailing zeros; never "MTR" or a base-unit count. */
import { describe, expect, it } from 'vitest';
import { localeT } from '@/routes/commerce/-shared/en-t';
import { formatQuantity } from './order-format';

const en = localeT('en');
const hi = localeT('hi');

describe('formatQuantity', () => {
    it('measured goods read "2.5 m"', () => {
        expect(formatQuantity(25, 10, 'MTR', en)).toBe('2.5 m');
        expect(formatQuantity(30, 10, 'MTR', en)).toBe('3 m');
        expect(formatQuantity(34, 10, 'MTR', en)).toBe('3.4 m');
        expect(formatQuantity(25, 10, 'MTR', hi)).toBe('2.5 मीटर');
        expect(formatQuantity(155, 10, 'KGS', en)).toBe('15.5 kg');
        // A blank unit is not guessed to be metres (W13): the number alone.
        expect(formatQuantity(25, 10, null, en)).toBe('2.5');
    });

    it('counted goods are whole numbers with no unit', () => {
        expect(formatQuantity(2, 1, 'PCS', en)).toBe('2');
        expect(formatQuantity(2, null, null, en)).toBe('2');
    });
});
