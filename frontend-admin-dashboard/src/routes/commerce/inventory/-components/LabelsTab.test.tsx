/**
 * Labels tab (owner decision 2026-11-18: labels are printed from the browser):
 * Print reads the print data for the chosen size, draws every label (QR and
 * Code 128) into the print view, prints, then asks whether they came out well;
 * only Yes marks them printed. Reprint needs a reason.
 */
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

const state = vi.hoisted(() => ({ access: null as unknown }));
vi.mock('@/lib/commerce/use-commerce-access', () => ({ useCommerceAccess: () => state.access }));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('@/lib/auth/sessionUtility', () => ({ getTokenFromCookie: () => 'token', getTokenDecodedData: () => ({ user: 'u-me' }) }));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('@/services/capabilities', () => ({
    readCurrentInstituteIdSafely: () => 'inst-1',
    syncCapabilitiesOnce: () => Promise.resolve(),
}));
vi.mock('@/components/common/layout-container/route-access-guard', () => ({
    NotInPlanPage: () => <div data-testid="locked-page" />,
}));
vi.mock('@/routes/commerce/orders/-shared/order-api', () => ({ scanCode: vi.fn() }));
vi.mock('@/routes/commerce/-components/ManagerPinDialog', () => ({
    ManagerPinDialog: ({
        open,
        onApprove,
        onOpenChange,
        managers,
    }: {
        open: boolean;
        onApprove: (a: { approver_user_id: string; pin: string }) => Promise<void>;
        onOpenChange: (open: boolean) => void;
        managers?: { user_id: string }[];
    }) =>
        open ? (
            <button
                type="button"
                data-testid="pin-approve"
                data-managers={(managers ?? []).map((m) => m.user_id).join(',')}
                onClick={() =>
                    void onApprove({ approver_user_id: 'm-1', pin: '123456' }).then(
                        () => onOpenChange(false),
                        () => undefined
                    )
                }
            >
                approve
            </button>
        ) : null,
}));
vi.mock('@tanstack/react-router', () => ({
    Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
    useNavigate: () => vi.fn(),
}));
vi.mock('../-shared/inventory-api', () => ({
    fetchLabels: vi.fn(),
    fetchLabelPrintData: vi.fn(),
    markLabelsPrinted: vi.fn(async () => ({ printed: 2, skipped: [] })),
    cancelLabels: vi.fn(),
    requestLabels: vi.fn(),
    fetchLabelsToReplace: vi.fn(async () => []),
    fetchStockApprovers: vi.fn(async () => []),
    searchVariants: vi.fn(async () => []),
}));

import * as orderApi from '@/routes/commerce/orders/-shared/order-api';
import * as api from '../-shared/inventory-api';
import { accessFor, labelRow, place, variantScan, WAREHOUSE } from '../-shared/inventory-test-fixtures';
import { LabelsTab } from './LabelsTab';
import { PrintLabelsDialog } from './PrintLabelsDialog';

const mocked = vi.mocked(api);

const renderTab = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const places = [place('L1', 'ST1')];
    return render(
        <QueryClientProvider client={client}>
            <LabelsTab locationId="L1" places={places} allPlaces={places} onPickLocation={() => undefined} />
        </QueryClientProvider>
    );
};

const printData = {
    shop_name: 'The shop',
    labels: [
        {
            request_id: 'lr-1',
            code: 'VABCDEFGH2',
            qr_value: 'https://shop.example/q/VABCDEFGH2',
            product_name: { en: 'Steel bottle', hi: 'स्टील की बोतल' },
            variant_name: { en: null, hi: null },
            price: 450,
            currency: 'INR',
            unit: 'PCS',
            sku: 'BOTTLE-1',
            copies: 2,
        },
        {
            request_id: 'lr-2',
            code: 'PABCDEFGH2',
            qr_value: 'PABCDEFGH2',
            product_name: { en: 'Cotton scarf', hi: null },
            variant_name: { en: null, hi: null },
            price: 1200,
            currency: 'INR',
            unit: 'PCS',
            sku: 'SCARF-1',
            copies: 1,
        },
    ],
    skipped: [],
    total_copies: 3,
};

/** The Print button, once the queue has loaded (it is disabled with nothing chosen). */
const openPrintButton = async () => {
    const button = await screen.findByTestId('labels-open-print');
    await waitFor(() => expect(button).not.toBeDisabled());
    return button;
};

describe('LabelsTab', () => {
    let print: MockInstance<[], void>;
    beforeEach(() => {
        vi.clearAllMocks();
        try {
            localStorage.clear();
        } catch {
            // No storage in this environment: the default choice applies.
        }
        state.access = accessFor(WAREHOUSE);
        mocked.fetchLabels.mockResolvedValue({
            rows: [labelRow('lr-1'), labelRow('lr-2', { piece_id: 'pc-1', piece_code: 'PABCDEFGH2', quantity: 1 })],
            page: 0,
            size: 100,
            total: 2,
        });
        mocked.fetchLabelPrintData.mockResolvedValue(printData);
        print = vi.spyOn(window, 'print').mockImplementation(() => {
            window.dispatchEvent(new Event('afterprint'));
        });
    });
    afterEach(() => print.mockRestore());

    it('prints the chosen labels in the chosen size, then marks them printed on Yes', async () => {
        renderTab();
        fireEvent.click(await openPrintButton());
        fireEvent.click(await screen.findByText('inventory.labels.templateA4_65'));
        fireEvent.click(screen.getByTestId('labels-print'));
        await waitFor(() => expect(screen.getByText('inventory.labels.cameOutWell')).toBeTruthy());
        expect(mocked.fetchLabelPrintData).toHaveBeenCalledWith({ request_ids: ['lr-1', 'lr-2'], size: 'A4_65' });
        expect(print).toHaveBeenCalledTimes(1);
        // Two copies of the bottle and one scarf, each with a barcode.
        expect(screen.getAllByTestId('print-label')).toHaveLength(3);
        expect(screen.getAllByTestId('label-barcode')).toHaveLength(3);
        expect(screen.getByTestId('label-print-view').textContent).toContain('स्टील की बोतल');
        expect(mocked.markLabelsPrinted).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId('labels-mark-printed'));
        await waitFor(() => expect(mocked.markLabelsPrinted).toHaveBeenCalledTimes(1));
        expect(mocked.markLabelsPrinted.mock.calls[0]?.[0]).toMatchObject({ request_ids: ['lr-1', 'lr-2'] });
    });

    it('No keeps the labels in the queue', async () => {
        renderTab();
        fireEvent.click(await openPrintButton());
        fireEvent.click(await screen.findByTestId('labels-print'));
        fireEvent.click(await screen.findByTestId('labels-keep-pending'));
        expect(mocked.fetchLabelPrintData).toHaveBeenCalledWith({ request_ids: ['lr-1', 'lr-2'], size: 'STICKER_50X25' });
        expect(mocked.markLabelsPrinted).not.toHaveBeenCalled();
    });

    it('reprint needs a reason', async () => {
        vi.mocked(orderApi.scanCode).mockResolvedValue(variantScan());
        renderTab();
        fireEvent.click(await screen.findByText('inventory.labels.reprint'));
        const box = (await screen.findByTestId('reprint-scan')) as HTMLInputElement;
        fireEvent.change(box, { target: { value: 'VABCDEFGH2' } });
        fireEvent.keyDown(box, { key: 'Enter' });
        await waitFor(() => expect(screen.getByTestId('reprint-scan-message').textContent).toBe('inventory.receive.added'));
        fireEvent.click(screen.getByTestId('reprint-save'));
        expect(await screen.findByText('inventory.reprint.problems.reason')).toBeTruthy();
        expect(mocked.requestLabels).not.toHaveBeenCalled();
    });
});

describe('LabelsTab fix round', () => {
    let print: MockInstance<[], void>;
    beforeEach(() => {
        vi.clearAllMocks();
        try {
            localStorage.clear();
            sessionStorage.clear();
        } catch {
            // No storage here.
        }
        state.access = accessFor(WAREHOUSE);
        mocked.fetchLabelPrintData.mockResolvedValue(printData);
        mocked.markLabelsPrinted.mockResolvedValue({ printed: 1, skipped: [] });
        print = vi.spyOn(window, 'print').mockImplementation(() => {
            window.dispatchEvent(new Event('afterprint'));
        });
    });
    afterEach(() => print.mockRestore());

    it('M2: a row without a price starts unticked and is not sent to print', async () => {
        mocked.fetchLabels.mockResolvedValue({
            rows: [labelRow('lr-1'), labelRow('lr-3', { has_price: false, sku: 'NEW-1' })],
            page: 0,
            size: 100,
            total: 2,
        });
        renderTab();
        fireEvent.click(await openPrintButton());
        fireEvent.click(await screen.findByTestId('labels-print'));
        await waitFor(() => expect(mocked.fetchLabelPrintData).toHaveBeenCalledTimes(1));
        expect(mocked.fetchLabelPrintData).toHaveBeenCalledWith({ request_ids: ['lr-1'], size: 'STICKER_50X25' });
    });

    it('M1: a receipt print marks every drawn label (not the first page), in batches of 200', async () => {
        mocked.fetchLabels.mockResolvedValue({
            rows: Array.from({ length: 100 }, (_, i) => labelRow(`r${i}`, { quantity: 1 })),
            page: 0,
            size: 100,
            total: 210,
        });
        const first = printData.labels[0] as (typeof printData.labels)[number];
        const drawn = Array.from({ length: 210 }, (_, i) => ({ ...first, request_id: `r${i}`, copies: 1 }));
        mocked.fetchLabelPrintData.mockResolvedValue({ ...printData, labels: drawn, total_copies: 210 });
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(
            <QueryClientProvider client={client}>
                <PrintLabelsDialog open onOpenChange={() => undefined} receiptId="rc-1" locationId="L1" />
            </QueryClientProvider>
        );
        await screen.findByText('inventory.labels.countReceipt');
        fireEvent.click(screen.getByTestId('labels-print'));
        await waitFor(() => expect(mocked.fetchLabelPrintData).toHaveBeenCalledWith({ receipt_id: 'rc-1', size: 'STICKER_50X25' }));
        fireEvent.click(await screen.findByTestId('labels-mark-printed'));
        await waitFor(() => expect(mocked.markLabelsPrinted).toHaveBeenCalledTimes(2));
        const sent = mocked.markLabelsPrinted.mock.calls.map((call) => call[0].request_ids);
        expect(sent.map((ids) => ids.length)).toEqual([200, 10]);
        expect(new Set(sent.flat()).size).toBe(210);
        expect(sent[0]?.[0]).toBe('r0');
    }, 20_000);

    it('M2: labels the server skipped for no price are listed after the print', async () => {
        mocked.fetchLabels.mockResolvedValue({ rows: [labelRow('lr-1')], page: 0, size: 100, total: 1 });
        mocked.fetchLabelPrintData.mockResolvedValue({
            ...printData,
            skipped: [{ request_id: 'lr-9', sku: 'NEW-9', reason: 'NO_PRICE' }],
        });
        renderTab();
        fireEvent.click(await openPrintButton());
        fireEvent.click(await screen.findByTestId('labels-print'));
        expect((await screen.findByTestId('labels-skipped')).textContent).toBe('inventory.labels.skippedNoPrice');
    });

    it('H2: tags to replace queue per piece / per roll / per unit in batches, and leave unpriced items out', async () => {
        mocked.fetchLabels.mockResolvedValue({ rows: [], page: 0, size: 100, total: 0 });
        const base = { item_name: null, printed_mrp: 100, current_mrp: 120, unit: 'PCS', qty_scale: 1, has_price: true, capped: false };
        mocked.fetchLabelsToReplace.mockResolvedValue([
            { ...base, package_session_id: 'saree', sku: 'SAREE', on_hand: 2, stock_mode: 'PIECE', labels: 2 },
            { ...base, package_session_id: 'cloth', sku: 'CLOTH', on_hand: 200, stock_mode: 'QUANTITY', unit: 'MTR', qty_scale: 10, labels: 1 },
            { ...base, package_session_id: 'new', sku: 'NEW', on_hand: 3, stock_mode: 'QUANTITY', has_price: false, labels: 3 },
            ...Array.from({ length: 120 }, (_, i) => ({
                ...base,
                package_session_id: `cup${i}`,
                sku: `CUP${i}`,
                on_hand: 5,
                stock_mode: 'QUANTITY',
                labels: 5,
            })),
        ]);
        mocked.requestLabels.mockResolvedValue([]);
        renderTab();
        fireEvent.click(await screen.findByText('inventory.labels.toReplace'));
        fireEvent.click(await screen.findByTestId('labels-queue-replace'));
        await waitFor(() => expect(mocked.requestLabels).toHaveBeenCalledTimes(2));
        const [first, second] = mocked.requestLabels.mock.calls.map((call) => call[0]);
        expect(first?.lines).toHaveLength(100);
        expect(second?.lines).toHaveLength(22);
        expect(first?.lines.slice(0, 3)).toEqual([
            { package_session_id: 'saree', quantity: 1 },
            { package_session_id: 'cloth', quantity: 1 },
            { package_session_id: 'cup0', quantity: 5 },
        ]);
        expect(first?.client_request_id).not.toBe(second?.client_request_id);
        expect(screen.getByTestId('replace-unpriced').textContent).toBe('inventory.labels.replaceUnpriced');
    });

    it('L7 (low): two reprint scans answered at once both land', async () => {
        mocked.fetchLabels.mockResolvedValue({ rows: [], page: 0, size: 100, total: 0 });
        vi.mocked(orderApi.scanCode)
            .mockResolvedValueOnce(variantScan({ package_session_id: 'ps-a', sku: 'A-1' }))
            .mockResolvedValueOnce(variantScan({ package_session_id: 'ps-b', sku: 'B-1' }));
        renderTab();
        fireEvent.click(await screen.findByText('inventory.labels.reprint'));
        const box = (await screen.findByTestId('reprint-scan')) as HTMLInputElement;
        fireEvent.change(box, { target: { value: 'VAAAAAAAA1' } });
        fireEvent.keyDown(box, { key: 'Enter' });
        fireEvent.change(box, { target: { value: 'VBBBBBBBB2' } });
        fireEvent.keyDown(box, { key: 'Enter' });
        await waitFor(() => expect(vi.mocked(orderApi.scanCode)).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(screen.getByText('B-1')).toBeTruthy());
        expect(screen.getByText('A-1')).toBeTruthy();
    });
});
