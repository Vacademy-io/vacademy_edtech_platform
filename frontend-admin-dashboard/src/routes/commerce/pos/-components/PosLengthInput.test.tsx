/** WP-44 FA5: the till's length box: rate per metre, live line total in paise, − / + a step, no rounding. */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async () => {
    const { localeT } = await import('@/routes/commerce/-shared/en-t');
    const t = localeT('en');
    return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});

import { cartStep, emptyCart } from '../-shared/pos-cart';
import { hose } from '../-shared/pos-test-fixtures';
import { decimalsFor, parseLength, PosLengthInput, stepLength } from './PosLengthInput';

describe('parseLength and decimalsFor', () => {
    it('decimals by scale', () => {
        expect(decimalsFor(1)).toBe(0);
        expect(decimalsFor(10)).toBe(1);
        expect(decimalsFor(100)).toBe(2);
    });

    it('refuses extra decimals, off-step and out-of-range lengths; never rounds', () => {
        expect(parseLength('3.4', 10, 1)).toEqual({ stored: 34 });
        expect(parseLength('3,4', 10, 1)).toEqual({ stored: 34 });
        expect(parseLength('3.45', 10, 1)).toEqual({ problem: 'decimals' });
        expect(parseLength('2.3', 10, 5)).toEqual({ problem: 'quantityStep' });
        expect(parseLength('2.5', 10, 5)).toEqual({ stored: 25 });
        expect(parseLength('0', 10, 1)).toEqual({ problem: 'quantityRange' });
        expect(parseLength('20000', 10, 1)).toEqual({ problem: 'quantityRange' });
        expect(parseLength('x', 10, 1)).toEqual({ problem: 'format' });
    });

    it('− / + move one step, onto the grid first, never below one step', () => {
        expect(stepLength(25, 5, 1)).toBe(30);
        expect(stepLength(25, 5, -1)).toBe(20);
        expect(stepLength(23, 5, 1)).toBe(25);
        expect(stepLength(23, 5, -1)).toBe(20);
        expect(stepLength(5, 5, -1)).toBe(5);
    });
});

const box = (over: Partial<Parameters<typeof PosLengthInput>[0]> = {}) => {
    const onSave = vi.fn();
    const onOpenChange = vi.fn();
    render(
        <PosLengthInput
            open
            onOpenChange={onOpenChange}
            name="Cotton cloth"
            unit="MTR"
            qtyScale={10}
            qtyStep={1}
            quantity={10}
            unitPrice={12.34}
            onHand={100}
            onSave={onSave}
            {...over}
        />
    );
    return { onSave, onOpenChange, input: screen.getByLabelText('Length in m') as HTMLInputElement };
};

describe('PosLengthInput', () => {
    it('shows the rate per metre, the stock here and the live line total in paise', () => {
        const { input } = box();
        expect(screen.getByTestId('pos-length-rate').textContent).toBe('₹123.40 / m');
        expect(screen.getByText('10 m here')).toBeTruthy();
        fireEvent.change(input, { target: { value: '3.4' } });
        expect(screen.getByTestId('pos-length-total').textContent).toBe('₹419.56');
    });

    it('extra decimals are said at once and not saved', () => {
        const { input, onSave } = box();
        fireEvent.change(input, { target: { value: '3.45' } });
        expect(screen.getByRole('alert').textContent).toContain('at most 1 decimal');
        expect(screen.getByTestId('pos-length-total').textContent).toBe('—');
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onSave).not.toHaveBeenCalled();
    });

    it('− / + buttons are 48 px and move one sale step; Enter saves the stored units', () => {
        const { input, onSave, onOpenChange } = box({ qtyStep: 5, quantity: 25, unitPrice: 20 });
        const more = screen.getByTestId('pos-length-more');
        expect(more.className).toContain('size-12');
        expect(screen.getByTestId('pos-length-less').className).toContain('size-12');
        fireEvent.click(more);
        expect(input.value).toBe('3');
        fireEvent.click(screen.getByTestId('pos-length-less'));
        fireEvent.click(screen.getByTestId('pos-length-less'));
        expect(input.value).toBe('2');
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onSave).toHaveBeenCalledWith(20);
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });
});

describe('a line just added by a scan', () => {
    it('is marked new so closing the box takes it off the bill; a repeat scan is not', () => {
        const first = cartStep(emptyCart(), { type: 'ADD_VARIANT', item: hose() });
        expect(first.openLengthFor).toBe('l1');
        expect(first.openLengthIsNew).toBe(true);
        const again = cartStep(first.state, { type: 'ADD_VARIANT', item: hose() });
        expect(again.openLengthFor).toBe('l1');
        expect(again.openLengthIsNew).toBeFalsy();
        // What the page sends when the box is closed without a length.
        expect(cartStep(first.state, { type: 'REMOVE_LINE', lineRef: 'l1' }).state.lines).toEqual([]);
    });
});
