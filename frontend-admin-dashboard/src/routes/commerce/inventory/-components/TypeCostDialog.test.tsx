/** WP-44 FA6 / D13: unit cost is typed per metre and sent per 10 cm with 4 decimals; nothing is rounded. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async () => {
    const { localeT } = await import('@/routes/commerce/-shared/en-t');
    const t = localeT('en');
    return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/routes/commerce/-components/ManagerPinDialog', () => ({ ManagerPinDialog: () => null }));
vi.mock('../-shared/inventory-api', () => ({
    typeReceiptCost: vi.fn(async () => ({})),
    fetchStockApprovers: vi.fn(async () => []),
}));

import * as api from '../-shared/inventory-api';
import type { ReceiptLine, ReceiptView } from '../-shared/inventory-types';
import { costLines, TypeCostDialog } from './TypeCostDialog';

const line = (id: string, qty_scale: number): ReceiptLine =>
    ({
        id,
        qty_scale,
        unit: qty_scale > 1 ? 'MTR' : 'PCS',
        qty_received: 100,
        unit_cost: null,
        pieces: [],
        product_name: id === 'cloth' ? 'Cotton cloth' : 'Steel bottle',
        variant_name: null,
        sku: id.toUpperCase(),
    }) as unknown as ReceiptLine;

const receipt = { lines: [line('cloth', 10), line('bottle', 1)] };

describe('costLines', () => {
    it('"80.00" a metre sends 8.0000; a bottle sends its cost as typed', () => {
        expect(costLines(receipt, { cloth: '80.00', bottle: '45.5' })).toEqual({
            lines: [
                { line_id: 'cloth', unit_cost: '8.0000' },
                { line_id: 'bottle', unit_cost: '45.5000' },
            ],
        });
    });

    it('a per-metre cost that does not fit 4 decimals per 10 cm is refused (at most 3 per metre)', () => {
        expect(costLines(receipt, { cloth: '80.0005' })).toEqual({ problemLineId: 'cloth', decimals: 3 });
        expect(costLines(receipt, { cloth: '80.005' })).toEqual({ lines: [{ line_id: 'cloth', unit_cost: '8.0005' }] });
        expect(costLines(receipt, { cloth: 'abc' })).toEqual({ problemLineId: 'cloth', decimals: null });
        expect(costLines(receipt, { cloth: ' ' })).toEqual({ problemLineId: null, decimals: null });
    });

    it('W4: a comma is refused ("use a dot"), never read as thousands', () => {
        expect(costLines(receipt, { bottle: '1,200' })).toEqual({ problemLineId: 'bottle', decimals: null, comma: true });
    });
});

describe('TypeCostDialog (rendered)', () => {
    const renderDialog = () =>
        render(
            <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
                <TypeCostDialog open onOpenChange={() => undefined} receipt={{ id: 'r-1', ...receipt } as unknown as ReceiptView} />
            </QueryClientProvider>
        );

    it('asks the cost per metre for cloth; "80,5" is refused; "80.005" a metre sends 8.0005', async () => {
        renderDialog();
        const cloth = screen.getByLabelText('Cost per m (₹)');
        fireEvent.change(cloth, { target: { value: '80,5' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(await screen.findByText('Use a dot for decimals, like 2.5.')).toBeTruthy();
        expect(api.typeReceiptCost).not.toHaveBeenCalled();
        fireEvent.change(cloth, { target: { value: '80.0005' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(await screen.findByText('Use at most 3 decimal places in the cost per unit.')).toBeTruthy();
        fireEvent.change(cloth, { target: { value: '80.005' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(api.typeReceiptCost).toHaveBeenCalledTimes(1));
        expect(vi.mocked(api.typeReceiptCost).mock.calls[0]?.[1].lines).toEqual([{ line_id: 'cloth', unit_cost: '8.0005' }]);
    });
});
