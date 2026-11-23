/**
 * POS review follow-ups (F-MAJOR 2): "Add return credit" finds the old bill and
 * puts one of its returns with credit waiting on the new bill.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
vi.mock('../-shared/pos-api', () => ({ lookupSales: vi.fn(), fetchSale: vi.fn() }));

import * as api from '../-shared/pos-api';
import type { SaleDetail, SaleRow } from '../-shared/pos-types';
import { PosAddCreditDialog, creditReturns } from './PosAddCreditDialog';

const mocked = vi.mocked(api);

const row = { order_id: 'o-1', order_number: 'ORD-1', invoice_number: 'C1/26-0001', total: 900 } as SaleRow;
const detail = (returns: SaleDetail['returns']) => ({ order_id: 'o-1', returns }) as SaleDetail;

describe('PosAddCreditDialog', () => {
    it('only received returns (credit waiting) are offered', () => {
        expect(
            creditReturns(
                detail([
                    { id: 'r-1', number: 'RET-1', status: 'RECEIVED', credit: 300 },
                    { id: 'r-2', number: 'RET-2', status: 'REFUNDED', credit: 100 },
                ])
            ).map((r) => r.id)
        ).toEqual(['r-1']);
    });

    it('bill number → its waiting return → on the bill', async () => {
        mocked.lookupSales.mockResolvedValue([row]);
        mocked.fetchSale.mockResolvedValue(detail([{ id: 'r-1', number: 'RET-1', status: 'RECEIVED', credit: 300 }]));
        const onPick = vi.fn();
        render(<PosAddCreditDialog open onOpenChange={() => undefined} sessionId="sess-1" online onPick={onPick} />);
        const box = screen.getByLabelText('pos.returns.find');
        fireEvent.change(box, { target: { value: 'C1/26-0001' } });
        fireEvent.keyDown(box, { key: 'Enter' });
        fireEvent.click(await screen.findByTestId('pos-add-credit-r-1'));
        expect(mocked.lookupSales).toHaveBeenCalledWith('sess-1', 'C1/26-0001');
        expect(onPick).toHaveBeenCalledWith({ returnId: 'r-1', number: 'RET-1', credit: 300 });
    });

    it('a bill without a waiting return says so', async () => {
        mocked.lookupSales.mockResolvedValue([row]);
        mocked.fetchSale.mockResolvedValue(detail([]));
        render(<PosAddCreditDialog open onOpenChange={() => undefined} sessionId="sess-1" online onPick={vi.fn()} />);
        const box = screen.getByLabelText('pos.returns.find');
        fireEvent.change(box, { target: { value: 'C1/26-0001' } });
        fireEvent.keyDown(box, { key: 'Enter' });
        await waitFor(() => expect(screen.getByTestId('pos-add-credit-none')).toBeTruthy());
    });
});
