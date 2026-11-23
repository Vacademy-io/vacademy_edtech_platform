/** Fix round L10 / F-M3: measured quantities show a unit sign or the metre word, never a raw code ("20.0 MTR"). */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

import { distinctParts, ItemCell, itemCellLines, parseDisplayQuantity, Qty, qtyUnit } from './inventory-ui';

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
        // W4: a comma is refused ("use a dot"), never read as a decimal point or thousands.
        expect(parseDisplayQuantity('2,5', 10)).toBeNull();
        expect(parseDisplayQuantity('2.50', 10)).toBe(25);
        expect(parseDisplayQuantity('3', 10)).toBe(30);
        expect(parseDisplayQuantity('1.5', 1)).toBeNull();
        expect(parseDisplayQuantity('12', 1)).toBe(12);
    });
});

describe('ItemCell (owner review: SKU printed twice, long names cut with no tooltip)', () => {
    it('a variant named after its SKU (the default when saved without a name) is not printed again', () => {
        expect(itemCellLines({ name: 'Velvet clutch', variant: 'BAGXX-00001', sku: 'BAGXX-00001' })).toEqual({
            title: 'Velvet clutch',
            variant: null,
            codes: 'BAGXX-00001',
        });
        const { container } = render(<ItemCell name="Velvet clutch" variant="bagxx-00001 " sku="BAGXX-00001" />);
        expect(container.textContent?.match(/BAGXX-00001/gi)?.length).toBe(1);
    });

    it('a real variant name and a different piece code still show', () => {
        expect(itemCellLines({ name: 'Saree', variant: 'Red / Large', sku: 'SAR-1', code: 'P-0007' })).toEqual({
            title: 'Saree',
            variant: 'Red / Large',
            codes: 'SAR-1 · P-0007',
        });
    });

    it('a label code equal to the SKU is shown once; a nameless item shows its SKU once, as the title', () => {
        expect(itemCellLines({ name: 'Bottle', sku: 'B-1', code: 'B-1' }).codes).toBe('B-1');
        expect(itemCellLines({ name: null, variant: 'B-1', sku: 'B-1' })).toEqual({ title: 'B-1', variant: null, codes: '' });
    });

    it('the name carries a title, so a truncated name can be read whole on hover', () => {
        const long = 'Hand embroidered velvet clutch with a long name';
        const { getByText } = render(<ItemCell name={long} sku="C-1" />);
        expect(getByText(long).getAttribute('title')).toBe(long);
    });
});

describe('distinctParts', () => {
    it('drops empty parts and repeats, ignoring case and spaces', () => {
        expect(distinctParts(['BAG-1', null, 'bag-1 ', 'Draft'])).toEqual(['BAG-1', 'Draft']);
        expect(distinctParts(['Red', 'BAG-1'])).toEqual(['Red', 'BAG-1']);
    });
});
