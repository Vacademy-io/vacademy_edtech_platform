/** Fix round L10 / F-M3: measured quantities show a unit sign or the metre word, never a raw code ("20.0 MTR"). */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

import { parseDisplayQuantity, Qty, qtyUnit } from './inventory-ui';

describe('Qty', () => {
    it('metres in the admin words, other units as signs, counted goods as whole numbers', () => {
        // WP-44 §3.1: trailing zeros dropped ("20 m", "2.5 m").
        expect(render(<Qty qty={200} scale={10} unit="MTR" />).container.textContent).toBe('20 orders.units.metre');
        expect(render(<Qty qty={25} scale={10} unit="MTR" />).container.textContent).toBe('2.5 orders.units.metre');
        expect(render(<Qty qty={155} scale={10} unit="KGS" />).container.textContent).toBe('15.5 kg');
        expect(render(<Qty qty={7} scale={1} unit="PCS" />).container.textContent).toBe('7');
        expect(qtyUnit('LTR', ((key: string) => key) as never)).toBe('l');
        expect(qtyUnit('MTR', ((key: string) => key) as never)).toBe('orders.units.metre');
    });
});

describe('parseDisplayQuantity (WP-44 FA1)', () => {
    it('refuses extra decimals instead of rounding them', () => {
        expect(parseDisplayQuantity('2.55', 10)).toBeNull();
        expect(parseDisplayQuantity('2,5', 10)).toBe(25);
        expect(parseDisplayQuantity('3', 10)).toBe(30);
        expect(parseDisplayQuantity('1.5', 1)).toBeNull();
        expect(parseDisplayQuantity('12', 1)).toBe(12);
    });
});
