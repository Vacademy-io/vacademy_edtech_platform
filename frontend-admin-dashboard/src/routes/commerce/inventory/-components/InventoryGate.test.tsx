/**
 * Contract §8.3 / §9, hidden unless Commerce is on: a cashier, an accountant
 * and an institute without the module fire no inventory request; warehouse
 * staff see no "Set reorder level" and no collection filter.
 */
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMERCE_ROLE } from '@/lib/commerce/commerce-access';

const state = vi.hoisted(() => ({ access: null as unknown }));
vi.mock('@/lib/commerce/use-commerce-access', () => ({ useCommerceAccess: () => state.access }));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('@/lib/auth/sessionUtility', () => ({ getTokenFromCookie: () => 'token', getTokenDecodedData: () => ({ user: 'u-me' }) }));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
    initReactI18next: { type: '3rdParty', init: () => undefined },
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
    useSearch: () => ({}),
}));
// The shared table pulls in unrelated screens; a plain table renders the same cells.
vi.mock('@/components/design-system/table', () => ({
    MyTable: ({
        data,
        columns,
    }: {
        data: { content: unknown[] };
        columns: { id: string; cell?: (ctx: { row: { original: unknown } }) => ReactNode }[];
    }) => (
        <table>
            <tbody>
                {data.content.map((row, index) => (
                    <tr key={index}>
                        {columns.map((column) => (
                            <td key={column.id}>{column.cell ? column.cell({ row: { original: row } }) : null}</td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    ),
}));
vi.mock('@/components/design-system/pagination', () => ({ MyPagination: () => null }));
const collections = vi.hoisted(() => vi.fn((..._args: unknown[]) => ({ data: { content: [] } })));
vi.mock('@/routes/commerce/-shared/commerce-hooks', () => ({ useCollections: collections }));
vi.mock('../-shared/inventory-api', () => ({
    fetchInventoryLocations: vi.fn(async () => []),
    fetchOverview: vi.fn(),
}));

import * as api from '../-shared/inventory-api';
import { accessFor, MANAGER, place, WAREHOUSE } from '../-shared/inventory-test-fixtures';
import { InventoryPage } from './InventoryPage';
import { StockTab } from './StockTab';

const mocked = vi.mocked(api);
const wrap = (node: ReactNode) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
};

describe('inventory gate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it.each([
        ['a cashier', accessFor([COMMERCE_ROLE.POS_CASHIER])],
        ['an accountant', accessFor([COMMERCE_ROLE.ACCOUNTANT])],
        ['an institute without the module', accessFor(['ADMIN'], false)],
    ])('%s fires no inventory request', async (_who, access) => {
        state.access = access;
        wrap(<InventoryPage />);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(mocked.fetchInventoryLocations).not.toHaveBeenCalled();
        expect(mocked.fetchOverview).not.toHaveBeenCalled();
    });

    it('warehouse staff open the page and read their places', async () => {
        state.access = accessFor(WAREHOUSE);
        wrap(<InventoryPage />);
        await waitFor(() => expect(mocked.fetchInventoryLocations).toHaveBeenCalled());
    });

    const overview = {
        locations: [{ id: 'L1', code: 'ST1', name: 'Store', gstin: null }],
        rows: [
            {
                package_session_id: 'ps-bottle',
                product_id: 'p-1',
                sku: 'BOTTLE-1',
                product_name: 'Steel bottle',
                variant_name: null,
                stock_mode: 'QUANTITY',
                unit: 'PCS',
                qty_scale: 1,
                label_code: null,
                levels: [{ location_id: 'L1', on_hand: 3, reorder_level: 5, low: true }],
                in_transit: 0,
                held_online: 0,
                sellable_online: null,
            },
        ],
        page: 0,
        size: 50,
        total: 1,
    };

    it('warehouse staff: no Set reorder level and no collection filter', async () => {
        state.access = accessFor(WAREHOUSE);
        mocked.fetchOverview.mockResolvedValue(overview);
        wrap(<StockTab locationId="L1" places={[place('L1', 'ST1')]} allPlaces={[]} onPickLocation={() => undefined} />);
        expect(await screen.findByText('inventory.stock.adjust')).toBeTruthy();
        expect(screen.queryByText('inventory.stock.setReorder')).toBeNull();
        expect(screen.queryByText('inventory.stock.collection')).toBeNull();
        expect(collections.mock.calls.every((call) => call[2] === false)).toBe(true);
    });

    it('a manager sees both', async () => {
        state.access = accessFor(MANAGER);
        mocked.fetchOverview.mockResolvedValue(overview);
        wrap(<StockTab locationId="L1" places={[place('L1', 'ST1')]} allPlaces={[]} onPickLocation={() => undefined} />);
        expect(await screen.findByText('inventory.stock.setReorder')).toBeTruthy();
        expect(screen.getByText('inventory.stock.collection')).toBeTruthy();
    });
});
