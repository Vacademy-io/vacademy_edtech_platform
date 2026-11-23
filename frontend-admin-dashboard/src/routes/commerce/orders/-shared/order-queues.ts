import { COMMERCE_ROLE, type CommerceAccess, type CommerceRoleName } from '@/lib/commerce/commerce-access';
import type { OrderQueue } from './order-types';

/**
 * The order desk queues (contract §5.1.1): which tabs a role sees, the row's
 * main button and the bulk actions. Pure, so the role rules are unit-tested.
 * The tabs are a convenience: every endpoint refuses a role it does not allow.
 */

const { STORE_MANAGER: M, WAREHOUSE_STAFF: W, ACCOUNTANT: AC } = COMMERCE_ROLE;

/** Desk roles (the institute ADMIN passes every role check). */
const GOODS: readonly CommerceRoleName[] = [M, W];
const MONEY: readonly CommerceRoleName[] = [M, AC];
const EVERYONE: readonly CommerceRoleName[] = [M, W, AC];

export type RowAction = 'CONFIRM' | 'PACK' | 'SHIP' | 'DELIVER' | 'RTO_RECEIVE' | 'RECORD_RECEIPT' | 'OPEN';

export type BulkActionId = 'CONFIRM' | 'PACK' | 'SHIP' | 'DELIVER' | 'REMITTANCE' | 'PRINT' | 'EXPORT';

export interface QueueDefinition {
    id: OrderQueue;
    /** Server `queue` parameter; null = no filter (All). */
    serverQueue: string | null;
    roles: readonly CommerceRoleName[];
    rowAction: RowAction | null;
    rowActionRoles: readonly CommerceRoleName[];
    bulk: readonly { id: BulkActionId; roles: readonly CommerceRoleName[] }[];
    /** Extra column of the tab. */
    extraColumn: 'tracking' | 'codToCollect' | 'due' | 'refundOpen' | 'returnState' | null;
}

export const QUEUE_DEFINITIONS: readonly QueueDefinition[] = [
    {
        id: 'TO_CONFIRM',
        serverQueue: 'TO_CONFIRM',
        roles: GOODS,
        rowAction: 'CONFIRM',
        rowActionRoles: GOODS,
        bulk: [{ id: 'CONFIRM', roles: GOODS }],
        extraColumn: null,
    },
    {
        id: 'TO_PACK',
        serverQueue: 'TO_PACK',
        roles: GOODS,
        rowAction: 'PACK',
        rowActionRoles: GOODS,
        bulk: [
            { id: 'PACK', roles: GOODS },
            { id: 'PRINT', roles: GOODS },
        ],
        extraColumn: null,
    },
    {
        id: 'TO_SHIP',
        serverQueue: 'TO_SHIP',
        roles: GOODS,
        rowAction: 'SHIP',
        rowActionRoles: GOODS,
        bulk: [
            { id: 'SHIP', roles: GOODS },
            { id: 'PRINT', roles: GOODS },
        ],
        extraColumn: 'tracking',
    },
    {
        id: 'IN_TRANSIT',
        serverQueue: 'IN_TRANSIT',
        roles: GOODS,
        rowAction: 'DELIVER',
        rowActionRoles: GOODS,
        bulk: [{ id: 'DELIVER', roles: GOODS }],
        extraColumn: 'tracking',
    },
    {
        id: 'COD_TO_COLLECT',
        serverQueue: 'COD_TO_COLLECT',
        roles: MONEY,
        rowAction: null,
        rowActionRoles: [],
        bulk: [{ id: 'REMITTANCE', roles: MONEY }],
        extraColumn: 'codToCollect',
    },
    {
        id: 'RTO_TO_RECEIVE',
        serverQueue: 'RTO_TO_RECEIVE',
        roles: GOODS,
        rowAction: 'RTO_RECEIVE',
        rowActionRoles: GOODS,
        bulk: [],
        extraColumn: null,
    },
    {
        id: 'STOCK_SHORT',
        serverQueue: 'STOCK_SHORT',
        roles: GOODS,
        rowAction: 'OPEN',
        rowActionRoles: GOODS,
        bulk: [],
        extraColumn: null,
    },
    {
        id: 'DUES',
        serverQueue: 'DUES',
        roles: MONEY,
        rowAction: 'RECORD_RECEIPT',
        rowActionRoles: MONEY,
        bulk: [],
        extraColumn: 'due',
    },
    {
        id: 'RETURNS',
        serverQueue: 'RETURNS',
        roles: GOODS,
        rowAction: 'OPEN',
        rowActionRoles: GOODS,
        bulk: [],
        extraColumn: 'returnState',
    },
    {
        id: 'REFUND_DUE',
        serverQueue: 'REFUND_DUE',
        roles: MONEY,
        rowAction: 'OPEN',
        rowActionRoles: MONEY,
        bulk: [],
        extraColumn: 'refundOpen',
    },
    {
        id: 'ALL',
        serverQueue: null,
        roles: EVERYONE,
        rowAction: 'OPEN',
        rowActionRoles: EVERYONE,
        bulk: [
            { id: 'EXPORT', roles: EVERYONE },
            { id: 'PRINT', roles: GOODS },
        ],
        extraColumn: null,
    },
];

const BY_ID = new Map<string, QueueDefinition>(QUEUE_DEFINITIONS.map((queue) => [queue.id, queue]));

export const queueDefinition = (id: string): QueueDefinition | undefined => BY_ID.get(id);

type RoleCheck = Pick<CommerceAccess, 'hasAnyRole'>;

export function visibleQueues(access: RoleCheck): QueueDefinition[] {
    return QUEUE_DEFINITIONS.filter((queue) => access.hasAnyRole(queue.roles));
}

/** Packing for the people who handle goods; COD to collect for an accountant (Q7). */
export function defaultQueue(access: RoleCheck): OrderQueue {
    if (access.hasAnyRole(GOODS)) return 'TO_PACK';
    if (access.hasAnyRole(MONEY)) return 'COD_TO_COLLECT';
    return 'ALL';
}

/** The tab to show: the asked one when the role sees it, else the default. */
export function resolveQueue(asked: string | undefined, access: RoleCheck): OrderQueue {
    const found = asked ? BY_ID.get(asked) : undefined;
    if (found && access.hasAnyRole(found.roles)) return found.id;
    return defaultQueue(access);
}

export function bulkActionsFor(queue: OrderQueue, access: RoleCheck): BulkActionId[] {
    const definition = BY_ID.get(queue);
    if (!definition || !access.hasAnyRole(definition.roles)) return [];
    return definition.bulk.filter((action) => access.hasAnyRole(action.roles)).map((action) => action.id);
}

export function rowActionFor(queue: OrderQueue, access: RoleCheck): RowAction | null {
    const definition = BY_ID.get(queue);
    if (!definition?.rowAction) return null;
    return access.hasAnyRole(definition.rowActionRoles) ? definition.rowAction : null;
}

export const ORDER_PAGE_SIZE = 50;

export interface OrderFilters {
    queue: OrderQueue;
    q?: string;
    from?: string;
    to?: string;
    channel?: string;
    method?: string;
    page?: number;
}

/** Query parameters of `GET /orders` for the desk's filters (no queue for All). */
export function listParams(filters: OrderFilters, pageSize = ORDER_PAGE_SIZE): Record<string, string | number> {
    const out: Record<string, string | number> = {};
    const queue = BY_ID.get(filters.queue)?.serverQueue;
    if (queue) out.queue = queue;
    const search = filters.q?.trim().slice(0, 64);
    if (search) out.search = search;
    if (filters.from) out.from = filters.from;
    if (filters.to) out.to = filters.to;
    if (filters.channel) out.channel = filters.channel;
    if (filters.method) out.payment_method = filters.method;
    out.page = Math.max(0, filters.page ?? 0);
    out.pageSize = Math.min(Math.max(1, pageSize), ORDER_PAGE_SIZE);
    return out;
}

/** The desk has a filter on beyond the tab (an empty list then says "nothing matches"). */
export const isFiltered = (filters: OrderFilters): boolean =>
    !!(filters.q?.trim() || filters.from || filters.to || filters.channel || filters.method);
