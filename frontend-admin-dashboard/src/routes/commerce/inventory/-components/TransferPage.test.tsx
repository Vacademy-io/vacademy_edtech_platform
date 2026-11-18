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
