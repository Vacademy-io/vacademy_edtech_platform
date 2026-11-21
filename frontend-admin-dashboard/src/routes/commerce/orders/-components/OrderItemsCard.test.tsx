/** WP-44 FA3: a measured line reads "2.5 m × ₹123.40 / m", never metres next to the price of 10 cm. */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async () => {
    const { localeT } = await import('@/routes/commerce/-shared/en-t');
    const t = localeT('en');
    return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});

import { detailFixture } from '../-shared/order-fixtures';
import { OrderItemsCard } from './OrderItemsCard';

const cloth = (over: Record<string, unknown> = {}) => ({
    id: 'line-c',
    line_no: 1,
    line_type: 'ITEM',
    package_session_id: 'ps-cloth',
    name: 'Cotton cloth',
    sku: 'CLOTH-1',
    unit: 'MTR',
    qty_scale: 10,
    quantity: 25,
    qty_cancelled: 0,
    qty_shipped: 0,
    qty_returned: 0,
    unit_price: '12.34',
    line_total: '308.50',
    ...over,
});

describe('OrderItemsCard', () => {
    it('measured line: length in metres and the rate per metre', () => {
        const view = render(<OrderItemsCard detail={detailFixture({ lines: [cloth()] })} />);
        const text = view.container.textContent ?? '';
        expect(text).toContain('2.5 m × ₹123.40 / m');
        expect(text).not.toContain('MTR');
        expect(text).not.toContain('₹12.34');
    });

    it('a staff price shows the list rate per metre too', () => {
        const line = cloth({ unit_price: '10.00', list_unit_price: '12.34', price_override_by: 'staff-1', qty_returned: 12 });
        const text = render(<OrderItemsCard detail={detailFixture({ lines: [line] })} />).container.textContent ?? '';
        expect(text).toContain('2.5 m × ₹100.00 / m');
        expect(text).toContain('₹123.40 / m');
        expect(text).toContain('1.2 m');
    });

    it('pieces keep their old text', () => {
        const text = render(<OrderItemsCard detail={detailFixture()} />).container.textContent ?? '';
        expect(text).toContain('2 × ₹500.00');
    });
});
