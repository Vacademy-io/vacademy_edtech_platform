/**
 * F1: the order detail's action table. The server's `next_actions` decides
 * every server button; the client actions follow role and data.
 */
import { describe, expect, it } from 'vitest';
import { COMMERCE_ROLE, resolveCommerceAccess } from '@/lib/commerce/commerce-access';
import {
    ACTION_DIALOG,
    NEVER_PRIMARY,
    PRIMARY_ORDER,
    clientActions,
    itemLines,
    liveShipment,
    openQuantity,
    orderButtons,
} from './order-actions';
import { detailFixture } from './order-fixtures';
import { ORDER_ACTION_CODES } from './order-types';

const access = (...roles: string[]) => resolveCommerceAccess({ roles, isFeatureOn: () => true });
const manager = access(COMMERCE_ROLE.STORE_MANAGER);
const warehouse = access(COMMERCE_ROLE.WAREHOUSE_STAFF);
const accountant = access(COMMERCE_ROLE.ACCOUNTANT);
const admin = access('ADMIN');

const codesOf = (items: { kind: string; code: string }[]) => items.map((item) => item.code);
const serverCodes = (detail: ReturnType<typeof detailFixture>, who = manager) => {
    const buttons = orderButtons(detail, who);
    return [
        ...(buttons.primary ? [buttons.primary] : []),
        ...buttons.secondary,
        ...buttons.overflow,
    ]
        .filter((item) => item.kind === 'server')
        .map((item) => item.code);
};

describe('action table', () => {
    it('maps every server code to exactly one dialog', () => {
        ORDER_ACTION_CODES.forEach((code) => expect(ACTION_DIALOG[code], code).toBeTruthy());
    });

    it('each offered code becomes exactly one button, none added', () => {
        const detail = detailFixture({ next_actions: ['CONFIRM', 'CANCEL', 'CANCEL_LINE'] });
        expect(serverCodes(detail).sort()).toEqual(['CANCEL', 'CANCEL_LINE', 'CONFIRM']);
    });

    it('picks the primary by the fixed order', () => {
        const detail = detailFixture({ next_actions: ['REFUND', 'RECORD_RECEIPT', 'DELIVER', 'RTO'] });
        const buttons = orderButtons(detail, manager);
        expect(buttons.primary).toEqual({ kind: 'server', code: 'DELIVER' });
        expect(codesOf(buttons.secondary)).toEqual(['RTO', 'RECORD_RECEIPT']);
        expect(codesOf(buttons.overflow)).toContain('REFUND');
    });

    it('never makes a destructive code primary', () => {
        const detail = detailFixture({ next_actions: ['CANCEL', 'UNPACK', 'UNDO_SHIP', 'UNDO_DELIVERY', 'RTO'] });
        const buttons = orderButtons(detail, manager);
        expect(buttons.primary).toBeNull();
        NEVER_PRIMARY.forEach((code) => expect(PRIMARY_ORDER).not.toContain(code));
        expect(codesOf(buttons.overflow)).toEqual(expect.arrayContaining(['CANCEL', 'UNPACK', 'UNDO_SHIP', 'UNDO_DELIVERY']));
    });

    it('a code missing from next_actions gives no button (warehouse without CANCEL)', () => {
        const detail = detailFixture({ next_actions: ['PACK'] }, { status: 'CONFIRMED' });
        expect(serverCodes(detail, warehouse)).toEqual(['PACK']);
    });

    it('ignores an unknown code and duplicates', () => {
        const detail = detailFixture({ next_actions: ['SHIP', 'TELEPORT', 'SHIP'] });
        expect(serverCodes(detail)).toEqual(['SHIP']);
    });
});

describe('client actions', () => {
    const codDelivered = (extra: Record<string, unknown> = {}) =>
        detailFixture(extra, { status: 'DELIVERED', payment_method: 'COD', payment_status: 'UNPAID' });

    it('COD remittance only for manager/accountant/admin on COD + DELIVERED + UNPAID without a remittance', () => {
        expect(clientActions(codDelivered(), manager)).toContain('RECORD_REMITTANCE');
        expect(clientActions(codDelivered(), accountant)).toContain('RECORD_REMITTANCE');
        expect(clientActions(codDelivered(), admin)).toContain('RECORD_REMITTANCE');
        expect(clientActions(codDelivered(), warehouse)).not.toContain('RECORD_REMITTANCE');
        expect(clientActions(codDelivered({ cod_remittance_id: 'rem-1' }), manager)).not.toContain('RECORD_REMITTANCE');
        expect(
            clientActions(detailFixture({}, { status: 'SHIPPED', payment_method: 'COD' }), manager)
        ).not.toContain('RECORD_REMITTANCE');
    });

    it('invoice download is hidden for warehouse staff', () => {
        const detail = detailFixture({ invoice_id: 'inv-1' }, { status: 'PACKED' });
        expect(clientActions(detail, warehouse)).not.toContain('DOWNLOAD_INVOICE');
        expect(clientActions(detail, accountant)).toContain('DOWNLOAD_INVOICE');
        expect(clientActions(detail, manager)).toContain('DOWNLOAD_INVOICE');
    });

    it('reissue as B2B only for manager/admin with an invoice and no buyer GSTIN', () => {
        const detail = detailFixture({ invoice_id: 'inv-1' });
        expect(clientActions(detail, manager)).toContain('REISSUE_B2B');
        expect(clientActions(detail, admin)).toContain('REISSUE_B2B');
        expect(clientActions(detail, accountant)).not.toContain('REISSUE_B2B');
        expect(clientActions(detailFixture({ invoice_id: 'inv-1', buyer_gstin: '27AAAAA0000A1Z5' }), manager)).not.toContain(
            'REISSUE_B2B'
        );
        expect(clientActions(detailFixture(), manager)).not.toContain('REISSUE_B2B');
    });

    it('print slip needs a live shipment and a goods role', () => {
        const shipped = detailFixture({ shipments: [{ id: 'sh-1', status: 'PACKED', lines: [] }] });
        expect(clientActions(shipped, warehouse)).toContain('PRINT_SLIP');
        expect(clientActions(shipped, accountant)).not.toContain('PRINT_SLIP');
        expect(clientActions(detailFixture(), warehouse)).not.toContain('PRINT_SLIP');
    });

    it('exchange needs a received return with credit left; revoke links is manager only', () => {
        const ret = { status: 'RECEIVED', due_raised: 500, refunded: 100 } as never;
        expect(clientActions(detailFixture(), manager, [ret])).toContain('EXCHANGE');
        expect(clientActions(detailFixture(), manager, [{ status: 'APPROVED', due_raised: 500, refunded: 0 } as never])).not.toContain(
            'EXCHANGE'
        );
        expect(clientActions(detailFixture(), warehouse)).not.toContain('REVOKE_LINKS');
        expect(clientActions(detailFixture(), manager)).toContain('REVOKE_LINKS');
    });
});

describe('helpers', () => {
    it('liveShipment skips a cancelled shipment', () => {
        const detail = detailFixture({
            shipments: [
                { id: 'old', status: 'CANCELLED', lines: [] },
                { id: 'live', status: 'PACKED', lines: [] },
            ],
        });
        expect(liveShipment(detail)?.id).toBe('live');
        expect(liveShipment(detailFixture({ shipments: [{ id: 'old', status: 'CANCELLED', lines: [] }] }))).toBeNull();
    });

    it('item lines only, and open quantity', () => {
        const detail = detailFixture();
        expect(itemLines(detail).map((line) => line.id)).toEqual(['line-1', 'line-2']);
        expect(openQuantity({ quantity: 5, qty_cancelled: 1, qty_shipped: 2 })).toBe(2);
        expect(openQuantity({ quantity: 1, qty_cancelled: 1, qty_shipped: 1 })).toBe(0);
    });
});
