/**
 * Contract §8.3, count sheet: no system quantity before Review; a V scan of a
 * piece item is refused; Post is disabled until the uncounted choice is made;
 * APPROVAL_REQUIRED opens the PIN dialog; a recount shows no review.
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
    useParams: () => ({ countId: 'c-1' }),
}));
vi.mock('../-shared/inventory-api', () => ({
    saveCountLines: vi.fn(),
    deleteCountLine: vi.fn(),
    postCount: vi.fn(),
    cancelCount: vi.fn(),
    fetchCountReview: vi.fn(),
    fetchStockApprovers: vi.fn(async () => [{ user_id: 'm-1', full_name: 'Test Manager' }]),
    searchVariants: vi.fn(async () => []),
}));

import * as orderApi from '@/routes/commerce/orders/-shared/order-api';
import * as api from '../-shared/inventory-api';
import { accessFor, countView, serverError, variantScan, WAREHOUSE } from '../-shared/inventory-test-fixtures';
import type { CountReview, CountView } from '../-shared/inventory-types';
import { CountSheet } from './CountSheetPage';

const mocked = vi.mocked(api);
const scanCode = vi.mocked(orderApi.scanCode);

const review: CountReview = {
    count_id: 'c-1',
    as_of: null,
    lines: [],
    uncounted: [],
    pieces: {
        missing_pieces: [],
        found_pieces: [],
        misplaced_pieces: [],
        not_in_stock_pieces: [],
        reserved_not_counted: [],
        arrived_during_count: [],
    },
    totals: { lines_with_difference: 0, units_up: 0, units_down: 0, value_up: null, value_down: null },
    needs_approval: true,
};

const renderSheet = (view: CountView) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <CountSheet view={view} />
        </QueryClientProvider>
    );
};

const scan = (text: string) => {
    const box = screen.getByTestId('count-scan') as HTMLInputElement;
    fireEvent.change(box, { target: { value: text } });
    fireEvent.keyDown(box, { key: 'Enter' });
};

describe('CountSheet', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.access = accessFor(WAREHOUSE);
        mocked.fetchCountReview.mockResolvedValue(review);
    });

    it('shows counted quantities only: no system quantity and no review read while counting', () => {
        renderSheet(countView());
        expect(screen.getByDisplayValue('12')).toBeTruthy();
        expect(screen.queryByText('inventory.review.now')).toBeNull();
        expect(screen.queryByText('inventory.stock.onHand')).toBeNull();
        expect(mocked.fetchCountReview).not.toHaveBeenCalled();
    });

    it('a V scan of a piece item is refused before any save', async () => {
        scanCode.mockResolvedValue(variantScan({ stock_mode: 'PIECE', package_session_id: 'ps-scarf' }));
        renderSheet(countView());
        scan('VABCDEFGH2');
        await waitFor(() =>
            expect(screen.getByTestId('count-scan-message').textContent).toBe('inventory.countSheet.scanPieceLabels')
        );
        expect(mocked.saveCountLines).not.toHaveBeenCalled();
    });

    it('a V scan of a quantity item is saved at once as ADD 1', async () => {
        scanCode.mockResolvedValue(variantScan({ package_session_id: 'ps-bag', sku: 'BAG-1' }));
        mocked.saveCountLines.mockResolvedValue({ lines: [{ ...countView().lines[0], counted_qty: 13 } as never], line_count: 1 });
        renderSheet(countView());
        scan('VABCDEFGH2');
        await waitFor(() => expect(mocked.saveCountLines).toHaveBeenCalledTimes(1));
        expect(mocked.saveCountLines.mock.calls[0]?.[1].lines).toEqual([{ package_session_id: 'ps-bag', mode: 'ADD', quantity: 1 }]);
        await waitFor(() => expect(screen.getByDisplayValue('13')).toBeTruthy());
    });

    it('Post stays disabled until the uncounted choice is made', async () => {
        renderSheet(countView());
        fireEvent.click(screen.getByTestId('count-open-post'));
        const post = await screen.findByTestId('count-post');
        expect(post).toBeDisabled();
        fireEvent.click(screen.getByText('inventory.counts.uncountedSKIP'));
        expect(screen.getByTestId('count-post')).not.toBeDisabled();
    });

    it('APPROVAL_REQUIRED opens the PIN dialog and resends with the approval, same id', async () => {
        mocked.postCount
            .mockRejectedValueOnce(serverError(403, 'APPROVAL_REQUIRED: STOCK_COUNT_POST above the limit'))
            .mockResolvedValueOnce(countView({ status: 'POSTED' }));
        renderSheet(countView());
        fireEvent.click(screen.getByTestId('count-open-post'));
        fireEvent.click(await screen.findByText('inventory.counts.uncountedZERO'));
        fireEvent.click(screen.getByTestId('count-post'));
        fireEvent.click(await screen.findByTestId('pin-approve'));
        await waitFor(() => expect(mocked.postCount).toHaveBeenCalledTimes(2));
        expect(mocked.fetchStockApprovers).toHaveBeenCalledWith('L1');
        const [first, second] = mocked.postCount.mock.calls.map((call) => call[1]);
        expect(first).toMatchObject({ uncounted: 'ZERO' });
        expect(second?.approval).toEqual({ approver_user_id: 'm-1', pin: '123456' });
        expect(second?.client_request_id).toBe(first?.client_request_id);
    });

    it('a recount has no review and finishes instead of posting', () => {
        renderSheet(countView({ kind: 'RECOUNT', recount_of_count_id: 'c-0' }));
        expect(screen.queryByTestId('count-review')).toBeNull();
        expect(screen.queryByTestId('count-open-post')).toBeNull();
        expect(screen.getByTestId('count-finish-recount')).toBeTruthy();
    });

    it('the main count cannot be posted while its recount is open', () => {
        renderSheet(countView({ recount: { id: 'c-2', status: 'OPEN', agreement: null } }));
        expect(screen.getByTestId('count-open-post')).toBeDisabled();
        expect(screen.getByText('inventory.counts.recountRunning')).toBeTruthy();
    });
});
