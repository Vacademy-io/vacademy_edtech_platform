import { describe, expect, it } from 'vitest';
import type { MappingRow, ProductPageInviteMappingResponse } from '../-types/product-page-types';
import { isLiveMapping, mappingsToRows, moveRowInList, sortByDisplayOrder } from './mapping-rows';

const mapping = (id: string, display_order: number, status = 'ACTIVE'): ProductPageInviteMappingResponse => ({
    id,
    ps_invite_payment_option_id: `bridge-${id}`,
    enroll_invite_id: `inv-${id}`,
    package_session_id: `ps-${id}`,
    payment_option_id: 'po',
    payment_plan_id: 'plan',
    payment_plan: {
        id: 'plan',
        name: 'Full',
        status: 'ACTIVE',
        validity_in_days: 365,
        actual_price: 100,
        elevated_price: 100,
        currency: 'INR',
        description: '',
        tag: '',
    },
    preselected: false,
    display_order,
    status,
    package_name: `Course ${id}`,
    level_name: 'Hindi',
});

const row = (rowId: string, displayOrder: number): MappingRow => ({
    rowId,
    inviteId: '',
    inviteName: '',
    psInvitePaymentOptionId: '',
    packageSessionId: rowId,
    paymentPlanId: '',
    paymentPlanName: '',
    paymentPlanPrice: 0,
    currency: '',
    preselected: false,
    displayOrder,
});

describe('sortByDisplayOrder', () => {
    it('orders by display_order and keeps arrival order for ties', () => {
        const sorted = sortByDisplayOrder([mapping('c', 2), mapping('a', 0), mapping('b', 0), mapping('d', 1)]);
        expect(sorted.map((m) => m.id)).toEqual(['a', 'b', 'd', 'c']);
    });

    it('puts rows without a display_order last, in arrival order', () => {
        const rows = [
            { id: 'x', display_order: null },
            { id: 'y', display_order: 3 },
            { id: 'z' },
        ];
        expect(sortByDisplayOrder(rows).map((m) => m.id)).toEqual(['y', 'x', 'z']);
    });
});

describe('mappingsToRows', () => {
    it('loads only live mappings, in display order, as editor rows', () => {
        const rows = mappingsToRows([mapping('b', 1), mapping('gone', 0, 'INACTIVE'), mapping('a', 0)]);
        expect(rows.map((r) => r.rowId)).toEqual(['a', 'b']);
        expect(rows[0]).toMatchObject({
            psInvitePaymentOptionId: 'bridge-a',
            packageSessionId: 'ps-a',
            paymentPlanPrice: 100,
            currency: 'INR',
            packageName: 'Course a',
            levelName: 'Hindi',
        });
    });

    it('treats a missing status as live and copes with no mappings', () => {
        expect(isLiveMapping({})).toBe(true);
        expect(isLiveMapping({ status: 'DELETED' })).toBe(false);
        expect(mappingsToRows(undefined)).toEqual([]);
    });
});

describe('moveRowInList', () => {
    const rows = [row('a', 0), row('b', 1), row('c', 2)];

    it('swaps with the neighbour and renumbers', () => {
        const down = moveRowInList(rows, 'a', 1);
        expect(down.map((r) => r.rowId)).toEqual(['b', 'a', 'c']);
        expect(down.map((r) => r.displayOrder)).toEqual([0, 1, 2]);
        expect(moveRowInList(rows, 'c', -1).map((r) => r.rowId)).toEqual(['a', 'c', 'b']);
    });

    it('returns the same array at the ends or for an unknown row', () => {
        expect(moveRowInList(rows, 'a', -1)).toBe(rows);
        expect(moveRowInList(rows, 'c', 1)).toBe(rows);
        expect(moveRowInList(rows, 'nope', 1)).toBe(rows);
    });

    it('does not mutate the input', () => {
        const copy = rows.map((r) => ({ ...r }));
        moveRowInList(rows, 'b', 1);
        expect(rows).toEqual(copy);
    });
});
