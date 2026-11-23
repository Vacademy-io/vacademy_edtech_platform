/** POS review follow-ups (MINOR 5): the next bill never shows the previous customer's name. */
import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: { name?: string }) => (options?.name ? `${key}:${options.name}` : key),
        i18n: { language: 'en' },
    }),
}));
vi.mock('../-shared/pos-api', () => ({ lookupCustomer: vi.fn() }));

import * as api from '../-shared/pos-api';
import { type CartCustomer, EMPTY_CUSTOMER } from '../-shared/pos-cart';
import { PosCustomerPanel } from './PosCustomerPanel';

const mocked = vi.mocked(api);

let setOutside: (c: CartCustomer) => void = () => undefined;
function Harness() {
    const [customer, setCustomer] = useState<CartCustomer>({ ...EMPTY_CUSTOMER });
    setOutside = setCustomer;
    return (
        <PosCustomerPanel
            sessionId="sess-1"
            customer={customer}
            online
            onChange={(change) => setCustomer((prev) => ({ ...prev, ...change }))}
        />
    );
}

const phone = () => screen.getByLabelText('pos.sell.phone') as HTMLInputElement;

describe('PosCustomerPanel', () => {
    it('a new bill clears the "Found" name of the last customer', async () => {
        mocked.lookupCustomer.mockResolvedValue({ found: true, name: 'First Buyer' });
        render(<Harness />);
        fireEvent.change(phone(), { target: { value: '9000000001' } });
        fireEvent.blur(phone());
        expect(await screen.findByText('pos.customer.found:First Buyer')).toBeTruthy();
        act(() => setOutside({ ...EMPTY_CUSTOMER })); // New bill
        await waitFor(() => expect(screen.queryByText('pos.customer.found:First Buyer')).toBeNull());
    });

    it('an answer for a phone that was edited meanwhile is dropped', async () => {
        let answer: (v: { found: boolean; name: string | null }) => void = () => undefined;
        mocked.lookupCustomer.mockImplementation(
            () =>
                new Promise((r) => {
                    answer = r;
                })
        );
        render(<Harness />);
        fireEvent.change(phone(), { target: { value: '9000000001' } });
        fireEvent.blur(phone());
        fireEvent.change(phone(), { target: { value: '9000000002' } });
        await act(async () => {
            answer({ found: true, name: 'Old Buyer' });
        });
        expect(screen.queryByText('pos.customer.found:Old Buyer')).toBeNull();
        expect(screen.queryByDisplayValue('Old Buyer')).toBeNull();
    });
});
