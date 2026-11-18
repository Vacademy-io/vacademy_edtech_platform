/**
 * Contract §8.3, Receive tab: a scanner's keystrokes and Enter add the item;
 * a QR link scan adds the same item; Save posts once on a double tap and a
 * retry after no answer reuses the request id; quick add adds a line; no cost
 * field anywhere for warehouse staff.
 */
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ access: null as unknown }));
vi.mock('@/lib/commerce/use-commerce-access', () => ({ useCommerceAccess: () => state.access }));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('@tanstack/react-router', () => ({
    Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
    useNavigate: () => vi.fn(),
}));
vi.mock('@/routes/commerce/-components/ManagerPinDialog', () => ({ ManagerPinDialog: () => null }));
vi.mock('@/routes/commerce/orders/-shared/order-api', () => ({ scanCode: vi.fn() }));
vi.mock('@/routes/commerce/-shared/commerce-hooks', () => ({
    useTaxClasses: () => ({ data: [] }),
    useTaxSettings: () => ({ data: undefined }),
    useCollections: () => ({ data: { content: [] } }),
}));
vi.mock('../-shared/inventory-api', () => ({
    createReceipt: vi.fn(),
    quickAddItem: vi.fn(),
    fetchReceipts: vi.fn(async () => ({ rows: [], page: 0, size: 10, total: 0 })),
    searchVariants: vi.fn(async () => []),
    fetchStockApprovers: vi.fn(async () => []),
    fetchLabels: vi.fn(async () => ({ rows: [], page: 0, size: 100, total: 0 })),
}));

import * as orderApi from '@/routes/commerce/orders/-shared/order-api';
import * as api from '../-shared/inventory-api';
import { accessFor, networkError, place, variantScan, WAREHOUSE } from '../-shared/inventory-test-fixtures';
import { ReceiveTab } from './ReceiveTab';

const mocked = vi.mocked(api);
const scanCode = vi.mocked(orderApi.scanCode);

const renderTab = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const places = [place('L1', 'ST1')];
    return render(
        <QueryClientProvider client={client}>
            <ReceiveTab locationId="L1" places={places} allPlaces={places} onPickLocation={() => undefined} />
        </QueryClientProvider>
    );
};

const scan = (text: string) => {
    const box = screen.getByTestId('stock-scan') as HTMLInputElement;
    fireEvent.change(box, { target: { value: text } });
    fireEvent.keyDown(box, { key: 'Enter', currentTarget: box });
};

const receipt = { id: 'r-1', receipt_number: 'GRN-000042', lines: [] } as never;

describe('ReceiveTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.access = accessFor(WAREHOUSE);
        scanCode.mockResolvedValue(variantScan());
    });

    it('a keystroke burst and Enter adds the scanned item', async () => {
        renderTab();
        scan('VABCDEFGH2');
        await waitFor(() => expect(screen.getByTestId('receive-lines').textContent).toContain('Steel bottle'));
        expect(scanCode).toHaveBeenCalledWith('VABCDEFGH2');
    });

    it("a label's QR link adds the same item (the code is looked up)", async () => {
        renderTab();
        scan('https://shop.example/q/VABCDEFGH2');
        await waitFor(() => expect(screen.getByTestId('receive-lines').textContent).toContain('Steel bottle'));
        expect(scanCode).toHaveBeenCalledWith('VABCDEFGH2');
    });

    it('Save posts once on a double tap and reuses the request id on a retry after no answer', async () => {
        let fail: (e: unknown) => void = () => undefined;
        mocked.createReceipt.mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)));
        mocked.createReceipt.mockResolvedValueOnce(receipt);
        renderTab();
        fireEvent.click(screen.getByText('inventory.receive.sourceOpening'));
        scan('VABCDEFGH2');
        await waitFor(() => screen.getByTestId('receive-lines'));
        const save = screen.getByTestId('receive-save');
        fireEvent.click(save);
        fireEvent.click(save);
        await waitFor(() => expect(mocked.createReceipt).toHaveBeenCalledTimes(1));
        await act(async () => fail(networkError()));
        await waitFor(() => expect(screen.getByTestId('receive-save')).not.toBeDisabled());
        fireEvent.click(screen.getByTestId('receive-save'));
        await waitFor(() => expect(mocked.createReceipt).toHaveBeenCalledTimes(2));
        const [first, second] = mocked.createReceipt.mock.calls.map((call) => call[0]);
        expect(second?.client_request_id).toBe(first?.client_request_id);
        expect(first).toMatchObject({ location_id: 'L1', source_kind: 'OPENING', lines: [{ package_session_id: 'ps-bottle', quantity: 1 }] });
        await waitFor(() => expect(screen.getByText('inventory.receive.done')).toBeTruthy());
    });

    it('quick add adds a line', async () => {
        mocked.quickAddItem.mockResolvedValue({
            product_id: 'p-new',
            package_session_id: 'ps-new',
            sku: 'QA-000001',
            name: 'Canvas bag',
            stock_mode: 'QUANTITY',
            unit: 'PCS',
            qty_scale: 1,
            status: 'DRAFT',
        });
        renderTab();
        fireEvent.click(screen.getByText('inventory.receive.quickAdd'));
        fireEvent.change(await screen.findByLabelText('inventory.quickAdd.nameEn'), { target: { value: 'Canvas bag' } });
        fireEvent.click(screen.getByText('products.selling.options.QUANTITY.title'));
        fireEvent.click(screen.getByText('inventory.quickAdd.save'));
        await waitFor(() => expect(screen.getByTestId('receive-lines').textContent).toContain('Canvas bag'));
        expect(mocked.quickAddItem.mock.calls[0]?.[0]).toMatchObject({
            name: { en: 'Canvas bag' },
            unit: 'PCS',
            stock_mode: 'QUANTITY',
            qty_scale: 1,
        });
    });

    it('shows no cost field and sends no cost', async () => {
        mocked.createReceipt.mockResolvedValue(receipt);
        const { container } = renderTab();
        fireEvent.click(screen.getByText('inventory.receive.sourceOpening'));
        scan('VABCDEFGH2');
        await waitFor(() => screen.getByTestId('receive-lines'));
        expect(container.textContent?.toLowerCase()).not.toContain('cost');
        fireEvent.click(screen.getByTestId('receive-save'));
        await waitFor(() => expect(mocked.createReceipt).toHaveBeenCalled());
        expect(JSON.stringify(mocked.createReceipt.mock.calls[0]?.[0])).not.toContain('cost');
    });
});
