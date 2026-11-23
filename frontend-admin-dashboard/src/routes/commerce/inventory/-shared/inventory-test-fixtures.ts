import { AxiosError, type AxiosResponse } from 'axios';
import { COMMERCE_ROLE, resolveCommerceAccess } from '@/lib/commerce/commerce-access';
import type { CommerceAccessState } from '@/lib/commerce/use-commerce-access';
import type { ScanResult } from '@/routes/commerce/orders/-shared/order-types';
import type { CountView, InventoryLocation, LabelRow, TransferView } from './inventory-types';

/** Neutral data for the inventory screen tests (no real shop, place or person). */

export const accessFor = (roles: string[], featureOn = true): CommerceAccessState => ({
    ...resolveCommerceAccess({ roles, isFeatureOn: () => featureOn }),
    isResolved: true,
});
export const MANAGER = [COMMERCE_ROLE.STORE_MANAGER];
export const WAREHOUSE = [COMMERCE_ROLE.WAREHOUSE_STAFF];

export function serverError(status: number, message: string): AxiosError {
    const response = { status, data: { message }, headers: {}, statusText: 'Error', config: {} } as unknown as AxiosResponse;
    return new AxiosError(message, String(status), undefined, undefined, response);
}
export const networkError = (): AxiosError => new AxiosError('Network Error', 'ERR_NETWORK');

export const place = (id: string, code: string, extra: Partial<InventoryLocation> = {}): InventoryLocation => ({
    id,
    code,
    name: `Place ${code}`,
    address_line1: null,
    address_line2: null,
    city: 'Test City',
    pincode: '100001',
    state_code: null,
    gstin: null,
    is_store: true,
    is_warehouse: false,
    is_source: false,
    is_temporary: false,
    starts_on: null,
    ends_on: null,
    sells_online: false,
    is_pos_enabled: false,
    status: 'ACTIVE',
    assigned: true,
    ...extra,
});

export const variantScan = (overrides: Partial<ScanResult['variant']> = {}): ScanResult => ({
    kind: 'VARIANT',
    variant: {
        package_session_id: 'ps-bottle',
        package_id: 'p-bottle',
        sku: 'BOTTLE-1',
        product_name: 'Steel bottle',
        variant_name: null,
        stock_mode: 'QUANTITY',
        stock_policy: 'TRACKED',
        unit: 'PCS',
        qty_scale: 1,
        ...overrides,
    },
    piece: null,
});

export const pieceScan = (code: string, locationId = 'L2'): ScanResult => ({
    kind: 'PIECE',
    variant: { ...variantScan().variant, package_session_id: 'ps-scarf', sku: 'SCARF-1', product_name: 'Cotton scarf', stock_mode: 'PIECE' },
    piece: { id: `pc-${code}`, code, status: 'IN_STOCK', location_id: locationId },
});

export const transferView = (overrides: Partial<TransferView> = {}): TransferView => ({
    id: 't-1',
    transfer_number: 'TRF-000001',
    status: 'DRAFT',
    from: { id: 'L2', code: 'WH1', name: 'Warehouse', gstin: null },
    to: { id: 'L1', code: 'ST1', name: 'Store', gstin: null },
    gstin_differs: false,
    document_type: null,
    document_number: null,
    document_date: null,
    eway_bill_no: null,
    note: null,
    receive_note: null,
    created_at: '2026-11-18T05:00:00Z',
    dispatched_at: null,
    received_at: null,
    cancelled_at: null,
    lines: [
        {
            id: 'line-1',
            package_session_id: 'ps-bottle',
            sku: 'BOTTLE-1',
            product_name: 'Steel bottle',
            item_name: 'Steel bottle',
            variant_name: null,
            stock_mode: 'QUANTITY',
            unit: 'PCS',
            qty_scale: 1,
            piece_id: null,
            piece_code: null,
            qty_sent: 10,
            qty_received: null,
            shortfall_reason: null,
            unit_value: 250,
            line_value: 2500,
            hsn_code: null,
        },
    ],
    totals: { qty_sent: 10, qty_received: 0, value: 2500 },
    overdue: false,
    warnings: [],
    next_actions: [],
    sellable_shortfall: [],
    replayed: false,
    ...overrides,
});

export const countView = (overrides: Partial<CountView> = {}): CountView => ({
    id: 'c-1',
    count_number: 'CNT-000001',
    kind: 'COUNT',
    status: 'OPEN',
    location: { id: 'L1', name: 'Store' },
    scope_collection: null,
    started_by: 'u-me',
    started_at: '2026-11-18T05:00:00Z',
    posted_at: null,
    line_count: 1,
    recount_of_count_id: null,
    recount: null,
    note: null,
    posted_by: null,
    uncounted_choice: null,
    summary: null,
    lines: [
        {
            id: 'cl-1',
            package_session_id: 'ps-bag',
            sku: 'BAG-1',
            product_name: 'Canvas bag',
            item_name: 'Canvas bag',
            variant_name: null,
            stock_mode: 'QUANTITY',
            unit: 'PCS',
            qty_scale: 1,
            piece_id: null,
            piece_code: null,
            counted_qty: 12,
            counted_at: '2026-11-18T05:10:00Z',
            counted_by: 'u-me',
        },
    ],
    next_actions: null,
    ...overrides,
});

export const labelRow = (id: string, overrides: Partial<LabelRow> = {}): LabelRow => ({
    id,
    location_id: 'L1',
    package_session_id: 'ps-bottle',
    sku: 'BOTTLE-1',
    item_name: 'Steel bottle',
    variant_name: null,
    piece_id: null,
    piece_code: null,
    label_code: 'VABCDEFGH2',
    quantity: 2,
    reason: 'NEW_RECEIPT',
    reprint_reason: null,
    note: null,
    source_type: 'STOCK_RECEIPT',
    source_id: 'r-1',
    source_label: 'GRN-000042',
    status: 'PENDING',
    created_at: '2026-11-18T05:00:00Z',
    printed_at: null,
    has_price: true,
    original_quantity: overrides.quantity ?? 2,
    printed_quantity: 0,
    stock_mode: 'QUANTITY',
    unit: 'PCS',
    qty_scale: 1,
    ...overrides,
});
