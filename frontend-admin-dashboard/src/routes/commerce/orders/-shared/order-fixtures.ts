import { normalizeDetail } from './order-api';
import type { StaffOrderDetail } from './order-types';

/**
 * Test data for the order desk tests: neutral products, no real names. Built
 * through the same normaliser the API answers go through.
 */
export function detailFixture(overrides: Record<string, unknown> = {}, order: Record<string, unknown> = {}): StaffOrderDetail {
    return normalizeDetail({
        order: {
            id: 'ord-1',
            order_number: 'SO-1001',
            channel: 'ONLINE',
            status: 'COD_PENDING_CONFIRMATION',
            payment_status: 'UNPAID',
            payment_method: 'COD',
            customer_name: 'Test Customer',
            customer_phone: '9000000001',
            currency: 'INR',
            total: '1200.00',
            amount_paid: 0,
            created_at: '2026-11-10T10:00:00Z',
            status_since: '2026-11-10T10:00:00Z',
            ...order,
        },
        fulfilment_location_id: 'loc-1',
        lines: [
            {
                id: 'line-1',
                line_no: 1,
                line_type: 'ITEM',
                package_session_id: 'ps-scarf',
                name: 'Cotton scarf',
                sku: 'SCARF-1',
                qty_scale: 1,
                quantity: 2,
                qty_cancelled: 0,
                qty_shipped: 0,
                qty_returned: 0,
                unit_price: '500.00',
            },
            {
                id: 'line-2',
                line_no: 2,
                line_type: 'ITEM',
                package_session_id: 'ps-bottle',
                name: 'Steel bottle',
                sku: 'BOTTLE-1',
                qty_scale: 1,
                quantity: 1,
                qty_cancelled: 0,
                qty_shipped: 0,
                qty_returned: 0,
                unit_price: '200.00',
            },
            {
                id: 'line-3',
                line_no: 3,
                line_type: 'SHIPPING',
                name: 'Shipping',
                qty_scale: 1,
                quantity: 1,
                qty_cancelled: 0,
                qty_shipped: 0,
                qty_returned: 0,
            },
        ],
        next_actions: [],
        ...overrides,
    });
}
