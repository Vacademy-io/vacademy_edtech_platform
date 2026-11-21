/** F2: queue tabs, default tab, list parameters and bulk actions per role. */
import { describe, expect, it } from 'vitest';
import { COMMERCE_ROLE, resolveCommerceAccess } from '@/lib/commerce/commerce-access';
import {
    bulkActionsFor,
    defaultQueue,
    listParams,
    resolveQueue,
    rowActionFor,
    visibleQueues,
} from './order-queues';
import { ORDER_QUEUES } from './order-types';

const access = (...roles: string[]) => resolveCommerceAccess({ roles, isFeatureOn: () => true });
const M = access(COMMERCE_ROLE.STORE_MANAGER);
const W = access(COMMERCE_ROLE.WAREHOUSE_STAFF);
const AC = access(COMMERCE_ROLE.ACCOUNTANT);
const AD = access('ADMIN');
const ids = (who: ReturnType<typeof access>) => visibleQueues(who).map((queue) => queue.id);

describe('visible tabs', () => {
    it('warehouse: goods queues and All', () => {
        expect(ids(W)).toEqual([
            'TO_CONFIRM',
            'TO_PACK',
            'TO_SHIP',
            'IN_TRANSIT',
            'RTO_TO_RECEIVE',
            'STOCK_SHORT',
            'RETURNS',
            'ALL',
        ]);
    });

    it('accountant: money queues and All', () => {
        expect(ids(AC)).toEqual(['COD_TO_COLLECT', 'DUES', 'REFUND_DUE', 'ALL']);
    });

    it('manager and admin: all eleven, in order', () => {
        expect(ids(M)).toEqual([...ORDER_QUEUES]);
        expect(ids(AD)).toEqual([...ORDER_QUEUES]);
    });

    it('a cashier sees no tab (the nav rule keeps them out anyway)', () => {
        expect(ids(access(COMMERCE_ROLE.POS_CASHIER))).toEqual([]);
    });
});

describe('default and resolved tab', () => {
    it('To pack for goods roles, COD to collect for an accountant', () => {
        expect(defaultQueue(M)).toBe('TO_PACK');
        expect(defaultQueue(W)).toBe('TO_PACK');
        expect(defaultQueue(AD)).toBe('TO_PACK');
        expect(defaultQueue(AC)).toBe('COD_TO_COLLECT');
    });

    it('a tab the role does not see falls back to the default', () => {
        expect(resolveQueue('DUES', W)).toBe('TO_PACK');
        expect(resolveQueue('DUES', AC)).toBe('DUES');
        expect(resolveQueue('NOPE', M)).toBe('TO_PACK');
        expect(resolveQueue(undefined, AC)).toBe('COD_TO_COLLECT');
    });
});

describe('listParams', () => {
    it('builds the server parameters', () => {
        expect(
            listParams({
                queue: 'TO_SHIP',
                q: '  SO-12 ',
                from: '2026-11-01',
                to: '2026-11-10',
                channel: 'ONLINE',
                method: 'COD',
                page: 2,
            })
        ).toEqual({
            queue: 'TO_SHIP',
            search: 'SO-12',
            from: '2026-11-01',
            to: '2026-11-10',
            channel: 'ONLINE',
            payment_method: 'COD',
            page: 2,
            pageSize: 50,
        });
    });

    it('All sends no queue; empty filters are left out; search is cut to 64', () => {
        const params = listParams({ queue: 'ALL', q: 'x'.repeat(80) });
        expect(params.queue).toBeUndefined();
        expect(params.search).toHaveLength(64);
        expect(params).toEqual({ search: 'x'.repeat(64), page: 0, pageSize: 50 });
    });
});

describe('bulk and row actions', () => {
    it('per tab and role', () => {
        expect(bulkActionsFor('TO_CONFIRM', W)).toEqual(['CONFIRM']);
        expect(bulkActionsFor('TO_PACK', W)).toEqual(['PACK', 'PRINT']);
        expect(bulkActionsFor('TO_SHIP', M)).toEqual(['SHIP', 'PRINT']);
        expect(bulkActionsFor('IN_TRANSIT', AD)).toEqual(['DELIVER']);
        expect(bulkActionsFor('COD_TO_COLLECT', AC)).toEqual(['REMITTANCE']);
        expect(bulkActionsFor('ALL', M)).toEqual(['EXPORT', 'PRINT']);
    });

    it('accountant has no Mark packed; warehouse has no remittance; All for an accountant is export only', () => {
        expect(bulkActionsFor('TO_PACK', AC)).toEqual([]);
        expect(bulkActionsFor('COD_TO_COLLECT', W)).toEqual([]);
        expect(bulkActionsFor('ALL', AC)).toEqual(['EXPORT']);
    });

    it('row buttons follow the tab', () => {
        expect(rowActionFor('TO_CONFIRM', W)).toBe('CONFIRM');
        expect(rowActionFor('TO_PACK', W)).toBe('PACK');
        expect(rowActionFor('DUES', AC)).toBe('RECORD_RECEIPT');
        expect(rowActionFor('DUES', W)).toBeNull();
        expect(rowActionFor('COD_TO_COLLECT', AC)).toBeNull();
        expect(rowActionFor('RTO_TO_RECEIVE', M)).toBe('RTO_RECEIVE');
    });
});
