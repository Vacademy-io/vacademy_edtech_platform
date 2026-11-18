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
    markLabelsPrinted: vi.fn(async () => 2),
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
