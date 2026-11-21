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

describe('ReceiveTab fix round', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        try {
            sessionStorage.clear();
        } catch {
            // No storage here.
        }
        state.access = accessFor(WAREHOUSE);
    });

    it('L9 (low): a scan of a measured roll adds no 0.1 m; the length must be typed before Save', async () => {
        scanCode.mockResolvedValue(variantScan({ package_session_id: 'ps-cloth', sku: 'CLOTH-1', product_name: 'Cotton cloth', unit: 'MTR', qty_scale: 10 }));
        mocked.createReceipt.mockResolvedValue(receipt);
        renderTab();
        fireEvent.click(screen.getByText('inventory.receive.sourceOpening'));
        scan('VCLOTH0001');
        await waitFor(() => expect(screen.getByTestId('receive-lines').textContent).toContain('Cotton cloth'));
        // W5: the empty length box says so and Save waits for it.
        expect(screen.getByTestId('receive-save')).toBeDisabled();
        expect(screen.getByText('units.problems.blank')).toBeTruthy();
        fireEvent.click(screen.getByTestId('receive-save'));
        expect(mocked.createReceipt).not.toHaveBeenCalled();
        fireEvent.change(screen.getByLabelText('inventory.receive.quantity'), { target: { value: '12.5' } });
        fireEvent.click(screen.getByTestId('receive-save'));
        await waitFor(() => expect(mocked.createReceipt).toHaveBeenCalledTimes(1));
        expect(mocked.createReceipt.mock.calls[0]?.[0].lines).toEqual([{ package_session_id: 'ps-cloth', quantity: 125 }]);
    });

    it('M4: a save with no answer keeps its request id when the tab is left and opened again', async () => {
        scanCode.mockResolvedValue(variantScan());
        mocked.createReceipt.mockRejectedValueOnce(networkError()).mockResolvedValueOnce(receipt);
        const first = renderTab();
        fireEvent.click(screen.getByText('inventory.receive.sourceOpening'));
        scan('VABCDEFGH2');
        await waitFor(() => screen.getByTestId('receive-lines'));
        fireEvent.click(screen.getByTestId('receive-save'));
        await waitFor(() => expect(mocked.createReceipt).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.getByTestId('receive-save')).not.toBeDisabled());
        first.unmount();
        renderTab();
        fireEvent.click(screen.getByText('inventory.receive.sourceOpening'));
        scan('VABCDEFGH2');
        await waitFor(() => screen.getByTestId('receive-lines'));
        fireEvent.click(screen.getByTestId('receive-save'));
        await waitFor(() => expect(mocked.createReceipt).toHaveBeenCalledTimes(2));
        const [a, b] = mocked.createReceipt.mock.calls.map((call) => call[0]);
        expect(b?.client_request_id).toBe(a?.client_request_id);
    });
});

describe('ReceiveTab: measured goods fix round (WP-44 W5, W6)', () => {
    const cloth = () =>
        variantScan({ package_session_id: 'ps-cloth', sku: 'CLOTH-1', product_name: 'Cotton cloth', unit: 'MTR', qty_scale: 10 });

    beforeEach(() => {
        vi.clearAllMocks();
        state.access = accessFor(WAREHOUSE);
        scanCode.mockResolvedValue(cloth());
        mocked.createReceipt.mockResolvedValue(receipt);
    });

    const startWithRoll = async () => {
        renderTab();
        fireEvent.click(screen.getByText('inventory.receive.sourceOpening'));
        scan('VCLOTH0001');
        await waitFor(() => expect(screen.getByTestId('receive-lines').textContent).toContain('Cotton cloth'));
        return screen.getByLabelText('inventory.receive.quantity') as HTMLInputElement;
    };

    it('W5: "23.75" typed after "23.7" blocks Save; the line is never posted at 23.7 m', async () => {
        const box = await startWithRoll();
        fireEvent.change(box, { target: { value: '23.7' } });
        expect(screen.getByTestId('receive-save')).not.toBeDisabled();
        fireEvent.change(box, { target: { value: '23.75' } });
        expect(screen.getByTestId('receive-save')).toBeDisabled();
        expect(screen.getByText('units.problems.decimals')).toBeTruthy();
        fireEvent.click(screen.getByTestId('receive-save'));
        expect(mocked.createReceipt).not.toHaveBeenCalled();
        fireEvent.change(box, { target: { value: '23.5' } });
        fireEvent.click(screen.getByTestId('receive-save'));
        await waitFor(() => expect(mocked.createReceipt).toHaveBeenCalledTimes(1));
        expect(mocked.createReceipt.mock.calls[0]?.[0].lines).toEqual([{ package_session_id: 'ps-cloth', quantity: 235 }]);
    });

    it('addendum 7: a measured item picked from the list opens its empty length box; a repeat pick reopens it', async () => {
        const pick = (over: Record<string, unknown>) => ({
            package_session_id: 'ps-cloth',
            sku: 'CLOTH-1',
            product_name: 'Cotton cloth',
            variant_name: null,
            stock_mode: 'QUANTITY',
            unit: 'MTR',
            qty_scale: 10,
            product_id: 'p-cloth',
            names: { en: 'Cotton cloth', hi: null },
            status: 'ACTIVE',
            stock_policy: 'TRACKED',
            qty_step: 5,
            label_code: null,
            barcode: null,
            on_hand: null,
            ...over,
        });
        mocked.searchVariants.mockImplementation(async ({ q }) =>
            q.startsWith('cot')
                ? [pick({})]
                : [pick({ package_session_id: 'ps-bottle', sku: 'BTL-1', product_name: 'Bottle', names: { en: 'Bottle', hi: null }, unit: 'PCS', qty_scale: 1, qty_step: 1 })]
        );
        const pickFromList = async (text: string, name: string) => {
            fireEvent.change(screen.getByTestId('stock-scan'), { target: { value: text } });
            fireEvent.click(await screen.findByRole('button', { name: new RegExp(name) }));
        };
        renderTab();
        fireEvent.click(screen.getByText('inventory.receive.sourceOpening'));

        await pickFromList('cot', 'Cotton cloth');
        const box = (await screen.findByLabelText('inventory.receive.quantity')) as HTMLInputElement;
        // No sale step (0.5 m) added: the box waits for the typed length and Save waits for it (W5).
        expect(box.value).toBe('');
        await waitFor(() => expect(document.activeElement).toBe(box));
        expect(screen.getByTestId('receive-save')).toBeDisabled();
        expect(screen.getByText('units.problems.blank')).toBeTruthy();

        fireEvent.change(box, { target: { value: '12.5' } });
        (screen.getByTestId('stock-scan') as HTMLInputElement).focus();
        await pickFromList('cot', 'Cotton cloth');
        // The same line's box again, its length kept: nothing added.
        expect(screen.getAllByLabelText('inventory.receive.quantity')).toHaveLength(1);
        expect(box.value).toBe('12.5');
        await waitFor(() => expect(document.activeElement).toBe(box));

        // A counted item still adds its step on each pick.
        await pickFromList('bot', 'Bottle');
        await pickFromList('bot', 'Bottle');
        const boxes = screen.getAllByLabelText('inventory.receive.quantity') as HTMLInputElement[];
        expect(boxes[1]?.value).toBe('2');

        fireEvent.click(screen.getByTestId('receive-save'));
        await waitFor(() => expect(mocked.createReceipt).toHaveBeenCalledTimes(1));
        expect(mocked.createReceipt.mock.calls[0]?.[0].lines).toEqual([
            { package_session_id: 'ps-cloth', quantity: 125 },
            { package_session_id: 'ps-bottle', quantity: 2 },
        ]);
    });

    it('W6: a label scanned into the length box is looked up as a scan and the box keeps its length', async () => {
        const box = await startWithRoll();
        fireEvent.change(box, { target: { value: '2' } });
        scanCode.mockClear();
        // A scanner: keys a few ms apart, then Enter.
        ['V', '1', '2', 'Enter'].forEach((key) => fireEvent.keyDown(box, { key }));
        await waitFor(() => expect(scanCode).toHaveBeenCalledWith('V12'));
        expect(box.value).toBe('2');
    });
});
