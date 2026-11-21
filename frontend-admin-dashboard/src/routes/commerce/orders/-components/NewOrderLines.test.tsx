/**
 * WP-44 W7 (MAJOR): a typed SKU on the staff order is looked up like a scanned
 * label, so a cloth line knows it is sold by the metre (scale, unit, step,
 * price) instead of being read as pieces of 10 cm.
 */
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async () => {
    const { localeT } = await import('@/routes/commerce/-shared/en-t');
    const t = localeT('en');
    return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('@/routes/commerce/orders/-shared/order-api', () => ({ scanCode: vi.fn() }));
vi.mock('@/routes/commerce/-shared/catalogue-api', () => ({ fetchProduct: vi.fn() }));
vi.mock('@/routes/commerce/-shared/commerce-api', () => ({ fetchProducts: vi.fn() }));

import { fetchProduct } from '@/routes/commerce/-shared/catalogue-api';
import { scanCode } from '@/routes/commerce/orders/-shared/order-api';
import { type NewOrderLine, validateNewOrder, emptyNewOrder } from '@/routes/commerce/orders/-shared/new-order';
import { NewOrderLines } from './NewOrderLines';

const scan = vi.mocked(scanCode);
const product = vi.mocked(fetchProduct);

let latest: NewOrderLine[] = [];
function Harness() {
    const [lines, setLines] = useState<NewOrderLine[]>([]);
    latest = lines;
    return (
        <NewOrderLines
            lines={lines}
            onChange={setLines}
            handOverNow={false}
            problems={validateNewOrder({ ...emptyNewOrder(), lines })}
            enabled
        />
    );
}

const renderLines = () =>
    render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <Harness />
        </QueryClientProvider>
    );

const typeSku = (sku: string) => {
    const box = screen.getByLabelText('Type a SKU');
    fireEvent.change(box, { target: { value: sku } });
    fireEvent.keyDown(box, { key: 'Enter' });
};

describe('typed SKU on a staff order', () => {
    beforeEach(() => {
        scan.mockReset();
        product.mockReset();
    });

    it('a cloth SKU becomes a length line: metres, its step and its price per metre', async () => {
        scan.mockResolvedValue({
            kind: 'VARIANT',
            variant: {
                package_session_id: 'ps-cloth',
                package_id: 'p-cloth',
                sku: 'CLOTH-1',
                product_name: 'Cotton cloth',
                variant_name: null,
                qty_scale: 10,
                unit: 'MTR',
            },
        } as never);
        product.mockResolvedValue({
            slug: 'cotton-cloth',
            translations: [{ locale: 'en', name: 'Cotton cloth' }],
            variants: [{ package_session_id: 'ps-cloth', price: 12.34 }],
            qty_scale: 10,
            qty_step: 5,
            unit: 'MTR',
        } as never);
        renderLines();
        typeSku('CLOTH-1');
        await waitFor(() => expect(latest).toHaveLength(1));
        expect(scan).toHaveBeenCalledWith('CLOTH-1');
        expect(latest[0]).toMatchObject({ variantId: 'ps-cloth', qtyScale: 10, qtyStep: 5, unit: 'MTR', listPrice: 12.34, quantity: '1' });
        expect(await screen.findByText('₹123.40 / m')).toBeTruthy();
        expect(screen.getByLabelText('Quantity (m)')).toBeTruthy();
    });

    it('an SKU the lookup does not know is kept for the server to price', async () => {
        scan.mockResolvedValue(null);
        renderLines();
        typeSku('OLD-SKU');
        await waitFor(() => expect(latest).toHaveLength(1));
        expect(latest[0]).toMatchObject({ variantId: null, sku: 'OLD-SKU', qtyScale: 1 });
    });
});
