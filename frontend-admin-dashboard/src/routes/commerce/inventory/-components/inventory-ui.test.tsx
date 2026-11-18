/** Fix round L10 / F-M3: measured quantities show a unit sign or the metre word, never a raw code ("20.0 MTR"). */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

import { Qty, qtyUnit } from './inventory-ui';

describe('Qty', () => {
    it('metres in the admin words, other units as signs, counted goods as whole numbers', () => {
        expect(render(<Qty qty={200} scale={10} unit="MTR" />).container.textContent).toBe('20.0 orders.units.metre');
        expect(render(<Qty qty={155} scale={10} unit="KGS" />).container.textContent).toBe('15.5 kg');
        expect(render(<Qty qty={7} scale={1} unit="PCS" />).container.textContent).toBe('7');
        expect(qtyUnit('LTR')).toBe('l');
    });
});
