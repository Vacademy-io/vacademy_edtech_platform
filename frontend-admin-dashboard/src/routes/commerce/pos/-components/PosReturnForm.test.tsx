/**
 * WP-44 F m6 / W5: the counter return screen itself (not only its helpers): a
 * cloth line gets typed boxes, "1.25" is said and disables the return, "1.2"
 * sends 12 base units, and Hindi digits are digits.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock('react-i18next', async () => {
    const { localeT } = await import('@/routes/commerce/-shared/en-t');
    const t = localeT('en');
    return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => () => undefined }));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('../-shared/pos-hooks', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    useCreatePosReturn: () => ({ mutateAsync: vi.fn() }),
    useReturnPreview: () => ({ data: undefined, isFetching: false, isError: false, error: null }),
    useDebounced: <T,>(value: T) => value,
}));
vi.mock('./PosPinGate', () => ({ usePinWrite: () => ({ run: hooks.run, dialog: null }) }));
// The design-system select is a popover; a native one stands in for choosing the reason.
vi.mock('@/routes/commerce/-components/CatalogueBits', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    PlainSelect: ({
        label,
        value,
        onChange,
        options,
    }: {
        label: string;
        value: string;
        onChange: (value: string) => void;
        options: { value: string; label: string }[];
    }) => (
        <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
            <option value="" />
            {options.map((o) => (
                <option key={o.value} value={o.value}>
                    {o.label}
                </option>
            ))}
        </select>
    ),
}));

import type { AttemptStore } from '../-shared/pos-session-store';
import type { SaleDetail } from '../-shared/pos-types';
import { session } from '../-shared/pos-test-fixtures';
import { ReturnForm } from './PosReturnPage';

const cloth = {
    order_line_id: 'c',
    line_no: 1,
    variant_id: 'v-cloth',
    sku: 'CLOTH-1',
    name: 'Cotton cloth',
    variant_label: null,
    unit: 'MTR',
    qty_scale: 10,
    quantity: 34,
    unit_price: 12.34,
    mrp: null,
    discount: 0,
    taxable_value: 0,
    tax_rate: null,
    tax_amount: 0,
    line_total: 419.56,
    piece_ids: [],
    piece_codes: [],
    qty_returned: 0,
    returnable: 34,
};

const sale = {
    order_id: 'o-1',
    order_number: 'POS-1',
    channel: 'POS',
    status: 'DELIVERED',
    session_id: 'sess-1',
    register_id: 'reg-1',
    location_id: 'loc-1',
    document: null,
    customer: null,
    lines: [cloth],
    totals: { subtotal: 419.56, discount: 0, tax: 0, round_off: 0.44, total: 420, amount_paid: 420, amount_refunded: 0 },
    tenders: [],
    change_due: null,
    returns: [],
    next_actions: [],
} as unknown as SaleDetail;

const attempts = { isUncertain: () => false, clear: vi.fn() } as unknown as AttemptStore;

const renderForm = () =>
    render(
        <ReturnForm session={session()} online sale={sale} attempts={attempts} onBack={() => undefined} onDone={() => undefined} />
    );

describe('counter return form, a cloth line', () => {
    beforeEach(() => hooks.run.mockReset());

    it('shows typed boxes per condition in metres', () => {
        renderForm();
        expect(screen.getByLabelText('Can be sold again (in m)')).toBeTruthy();
        expect(screen.getByTestId('pos-return-length-damaged')).toBeTruthy();
    });

    it('"1.25" is said and disables the return; "1.2" sends 12 resaleable', async () => {
        renderForm();
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'DEFECTIVE' } });
        const good = screen.getByTestId('pos-return-length-good');
        fireEvent.change(good, { target: { value: '1.25' } });
        expect(screen.getByRole('alert').textContent).toBe('Use at most 1 decimal place, like 2.5. Nothing is rounded.');
        expect(screen.getByTestId('pos-return-submit')).toBeDisabled();
        fireEvent.change(good, { target: { value: '1.2' } });
        expect(screen.getByTestId('pos-return-submit')).not.toBeDisabled();
        fireEvent.click(screen.getByTestId('pos-return-submit'));
        await waitFor(() => expect(hooks.run).toHaveBeenCalledTimes(1));
        expect(hooks.run.mock.calls[0]?.[0].lines).toEqual([{ order_line_id: 'c', quantity: 12, condition: 'RESALEABLE' }]);
    });

    it('n4: Hindi digits are read, not dropped', () => {
        renderForm();
        const good = screen.getByTestId('pos-return-length-good') as HTMLInputElement;
        fireEvent.change(good, { target: { value: '१.२' } });
        expect(good.value).toBe('१.२');
        expect(screen.queryByRole('alert')).toBeNull();
    });
});
