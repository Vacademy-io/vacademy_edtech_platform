/**
 * Contract §8.3, transfer page: different GSTINs (a manager records the
 * document, warehouse staff read why and cannot dispatch); PROMISED_ONLINE
 * confirmed by a manager is sent again with the flag; receive: a short line
 * needs a reason; APPROVAL_REQUIRED opens the PIN dialog with the approvers of
 * the destination and resends with the approval under the same request id.
 */
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    useParams: () => ({ transferId: 't-1' }),
}));
vi.mock('../-shared/inventory-api', () => ({
    fetchTransfer: vi.fn(),
    fetchInventoryLocations: vi.fn(),
    updateTransfer: vi.fn(),
    cancelTransfer: vi.fn(),
    dispatchTransfer: vi.fn(),
    receiveTransfer: vi.fn(),
    fetchChallanPdf: vi.fn(),
    fetchStockApprovers: vi.fn(async () => [{ user_id: 'm-1', full_name: 'Test Manager' }]),
    searchVariants: vi.fn(async () => []),
}));

import * as orderApi from '@/routes/commerce/orders/-shared/order-api';
import * as api from '../-shared/inventory-api';
import { accessFor, MANAGER, place, serverError, transferView, WAREHOUSE } from '../-shared/inventory-test-fixtures';
import { TransferPage } from './TransferPage';

const mocked = vi.mocked(api);

const renderPage = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <TransferPage />
        </QueryClientProvider>
    );
};

describe('TransferPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocked.fetchInventoryLocations.mockResolvedValue([place('L1', 'ST1'), place('L2', 'WH1')]);
    });

    it('different GSTINs: a manager records the external document number', async () => {
        state.access = accessFor(MANAGER);
        mocked.fetchTransfer.mockResolvedValue(transferView({ gstin_differs: true }));
        renderPage();
        fireEvent.click(await screen.findByTestId('open-dispatch'));
        expect(await screen.findByTestId('dispatch-document-number')).toBeTruthy();
        expect(screen.getByTestId('dispatch-send')).toBeTruthy();
    });

    it('different GSTINs: warehouse staff see the sentence and no Dispatch', async () => {
        state.access = accessFor(WAREHOUSE);
        mocked.fetchTransfer.mockResolvedValue(transferView({ gstin_differs: true }));
        renderPage();
        expect((await screen.findAllByText('inventory.transfers.needsDocument')).length).toBeGreaterThan(0);
        expect(screen.queryByTestId('open-dispatch')).toBeNull();
    });

    it('PROMISED_ONLINE: a manager confirms and the request goes again with the flag, under a new id', async () => {
        state.access = accessFor(MANAGER);
        mocked.fetchTransfer.mockResolvedValue(transferView());
        mocked.dispatchTransfer
            .mockRejectedValueOnce(serverError(409, 'PROMISED_ONLINE: 3 unit(s) of BOTTLE-1 are held or sold online'))
            .mockResolvedValueOnce(transferView({ status: 'DISPATCHED', document_number: 'DC/2026-00001' }));
        renderPage();
        fireEvent.click(await screen.findByTestId('open-dispatch'));
        fireEvent.click(await screen.findByTestId('dispatch-send'));
        expect(await screen.findByTestId('dispatch-promised')).toBeTruthy();
        fireEvent.click(screen.getByTestId('dispatch-send-anyway'));
        await waitFor(() => expect(mocked.dispatchTransfer).toHaveBeenCalledTimes(2));
        const [first, second] = mocked.dispatchTransfer.mock.calls.map((call) => call[1]);
        expect(first?.confirm_promised_online).toBeUndefined();
        expect(second?.confirm_promised_online).toBe(true);
        expect(second?.client_request_id).not.toBe(first?.client_request_id);
        expect(await screen.findByTestId('dispatch-print-challan')).toBeTruthy();
    });

    it('PROMISED_ONLINE: warehouse staff get the sentence and no way to send anyway', async () => {
        state.access = accessFor(WAREHOUSE);
        mocked.fetchTransfer.mockResolvedValue(transferView());
        mocked.dispatchTransfer.mockRejectedValueOnce(serverError(409, 'PROMISED_ONLINE: 3 unit(s) of BOTTLE-1'));
        renderPage();
        fireEvent.click(await screen.findByTestId('open-dispatch'));
        fireEvent.click(await screen.findByTestId('dispatch-send'));
        expect((await screen.findByTestId('dispatch-promised')).textContent).toBe('inventory.errors.PROMISED_ONLINE');
        expect(screen.queryByTestId('dispatch-send-anyway')).toBeNull();
    });

    it('receive: a short line needs a reason before Receive', async () => {
        state.access = accessFor(WAREHOUSE);
        mocked.fetchTransfer.mockResolvedValue(transferView({ status: 'DISPATCHED' }));
        renderPage();
        const qty = await screen.findByDisplayValue('10');
        expect(screen.getByTestId('receive-transfer')).not.toBeDisabled();
        fireEvent.change(qty, { target: { value: '7' } });
        expect(screen.getByTestId('receive-transfer')).toBeDisabled();
        expect(screen.getByText('inventory.receiveTransfer.needReasons')).toBeTruthy();
        expect(screen.getAllByText('inventory.transfers.shortReason').length).toBeGreaterThan(0);
    });

    it("receive: APPROVAL_REQUIRED asks the destination's managers and resends with the approval, same id", async () => {
        state.access = accessFor(WAREHOUSE);
        mocked.fetchTransfer.mockResolvedValue(transferView({ status: 'DISPATCHED' }));
        mocked.receiveTransfer
            .mockRejectedValueOnce(serverError(403, 'APPROVAL_REQUIRED: STOCK_TRANSFER_SHORT above the limit'))
            .mockResolvedValueOnce(transferView({ status: 'RECEIVED' }));
        renderPage();
        fireEvent.click(await screen.findByTestId('receive-transfer'));
        const approve = await screen.findByTestId('pin-approve');
        expect(mocked.fetchStockApprovers).toHaveBeenCalledWith('L1');
        expect(approve.getAttribute('data-managers')).toBe('m-1');
        fireEvent.click(approve);
        await waitFor(() => expect(mocked.receiveTransfer).toHaveBeenCalledTimes(2));
        const [first, second] = mocked.receiveTransfer.mock.calls.map((call) => call[1]);
        expect(first?.approval).toBeUndefined();
        expect(second?.approval).toEqual({ approver_user_id: 'm-1', pin: '123456' });
        expect(second?.client_request_id).toBe(first?.client_request_id);
    });
});

describe('TransferPage: measured goods fix round (WP-44 W5, W6, K M5)', () => {
    const clothLine = (over: Record<string, unknown> = {}) => ({
        ...transferView().lines[0]!,
        id: 'line-cloth',
        package_session_id: 'ps-cloth',
        sku: 'CLOTH-1',
        item_name: 'Cotton cloth',
        unit: 'MTR',
        qty_scale: 10,
        qty_sent: 237,
        ...over,
    });
    const scanCode = vi.mocked(orderApi.scanCode);

    beforeEach(() => {
        vi.clearAllMocks();
        mocked.fetchInventoryLocations.mockResolvedValue([place('L1', 'ST1'), place('L2', 'WH1')]);
        state.access = accessFor(MANAGER);
    });

    it('W5: "23.75" after "23.7" blocks Save and Dispatch; a good length saves what the box reads', async () => {
        mocked.fetchTransfer.mockResolvedValue(transferView({ lines: [clothLine()] }));
        mocked.updateTransfer.mockResolvedValue(transferView({ lines: [clothLine({ qty_sent: 235 })] }));
        renderPage();
        const box = (await screen.findByDisplayValue('23.7')) as HTMLInputElement;
        fireEvent.change(box, { target: { value: '23.75' } });
        expect(screen.getByTestId('transfer-save')).toBeDisabled();
        expect(screen.getByTestId('open-dispatch')).toBeDisabled();
        expect(screen.getByText('units.problems.decimals')).toBeTruthy();
        fireEvent.change(box, { target: { value: '0' } });
        expect(screen.getByTestId('transfer-save')).toBeDisabled();
        expect(screen.getByText('units.problems.aboveZero')).toBeTruthy();
        fireEvent.change(box, { target: { value: '23.5' } });
        expect(screen.getByTestId('transfer-save')).not.toBeDisabled();
        fireEvent.click(screen.getByTestId('transfer-save'));
        await waitFor(() => expect(mocked.updateTransfer).toHaveBeenCalledTimes(1));
        expect(mocked.updateTransfer.mock.calls[0]?.[1].lines).toEqual([{ package_session_id: 'ps-cloth', quantity: 235 }]);
    });

    it('W6: a label scanned into a length box goes to the scan lookup; the box keeps its length', async () => {
        scanCode.mockResolvedValue(null as never);
        mocked.fetchTransfer.mockResolvedValue(transferView({ lines: [clothLine()] }));
        renderPage();
        const box = (await screen.findByDisplayValue('23.7')) as HTMLInputElement;
        ['V', '1', '2', 'Enter'].forEach((key) => fireEvent.keyDown(box, { key }));
        await waitFor(() => expect(scanCode).toHaveBeenCalledWith('V12'));
        expect(box.value).toBe('23.7');
        expect(mocked.updateTransfer).not.toHaveBeenCalled();
    });

    it('W5: receive: a cleared box is never the full sent length; Receive waits', async () => {
        state.access = accessFor(WAREHOUSE);
        mocked.fetchTransfer.mockResolvedValue(transferView({ status: 'DISPATCHED', lines: [clothLine({ qty_sent: 30 })] }));
        renderPage();
        const box = await screen.findByDisplayValue('3');
        expect(screen.getByTestId('receive-transfer')).not.toBeDisabled();
        fireEvent.change(box, { target: { value: '' } });
        expect(screen.getByTestId('receive-transfer')).toBeDisabled();
        expect(screen.getByText('units.problems.blank')).toBeTruthy();
        fireEvent.change(box, { target: { value: '3.5' } });
        expect(screen.getByTestId('receive-transfer')).toBeDisabled();
        fireEvent.click(screen.getByTestId('receive-transfer'));
        expect(mocked.receiveTransfer).not.toHaveBeenCalled();
    });

    it('K M5: scanning a roll on receive opens its box and keeps the other typed boxes', async () => {
        state.access = accessFor(WAREHOUSE);
        const bottle = transferView().lines[0]!;
        mocked.fetchTransfer.mockResolvedValue(
            transferView({ status: 'DISPATCHED', lines: [bottle, clothLine({ qty_sent: 30 })] })
        );
        scanCode.mockResolvedValue({
            kind: 'VARIANT',
            variant: { package_session_id: 'ps-cloth', sku: 'CLOTH-1', product_name: 'Cotton cloth', qty_scale: 10, unit: 'MTR' },
        } as never);
        renderPage();
        const bottleBox = await screen.findByDisplayValue('10');
        fireEvent.change(bottleBox, { target: { value: '8' } });
        const clothBox = screen.getByDisplayValue('3');
        fireEvent.change(clothBox, { target: { value: '2' } });
        const scanBox = screen.getByTestId('receive-scan') as HTMLInputElement;
        fireEvent.change(scanBox, { target: { value: 'VCLOTH0001' } });
        fireEvent.keyDown(scanBox, { key: 'Enter' });
        await waitFor(() => expect(scanCode).toHaveBeenCalledWith('VCLOTH0001'));
        await waitFor(() => expect(screen.getByText('inventory.transferLines.typeLength')).toBeTruthy());
        // Nothing added a scan's worth (0.1 m) and the bottle's typed 8 is still there.
        expect((screen.getByDisplayValue('2') as HTMLInputElement).id).toBe('receive-qty-line-cloth');
        expect(screen.getByDisplayValue('8')).toBeTruthy();
    });
});
