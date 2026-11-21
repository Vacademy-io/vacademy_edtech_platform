import { COMMERCE_ROLE, type CommerceAccess } from '@/lib/commerce/commerce-access';
import {
    ORDER_ACTION_CODES,
    type OrderActionCode,
    type ReturnView,
    type StaffOrderDetail,
    type StaffOrderLine,
    type StaffShipment,
} from './order-types';

/**
 * The order detail's action table (contract §5.2.2–§5.2.3). The server's
 * `next_actions` decides every server action: the UI never adds a code the list
 * lacks and never hides one it has; a code it does not know is ignored. The
 * client actions (no server code) follow the role and the data.
 */

/** First present wins; destructive codes are never primary. */
export const PRIMARY_ORDER: readonly OrderActionCode[] = [
    'CONFIRM',
    'PACK',
    'SHIP',
    'DELIVER',
    'RTO_RECEIVE',
    'RECORD_RECEIPT',
    'REFUND',
    'CREATE_RETURN',
];

/** Buttons next to the primary one (at most two are shown as buttons). */
export const SECONDARY_ORDER: readonly OrderActionCode[] = ['RTO', 'EDIT_TRACKING'];

export const OVERFLOW_ORDER: readonly OrderActionCode[] = [
    'CANCEL',
    'CANCEL_LINE',
    'UNPACK',
    'UNDO_SHIP',
    'UNDO_DELIVERY',
    'CLEAR_STOCK_SHORT',
];

export const NEVER_PRIMARY: ReadonlySet<OrderActionCode> = new Set([
    'CANCEL',
    'CANCEL_LINE',
    'UNPACK',
    'UNDO_SHIP',
    'UNDO_DELIVERY',
    'RTO',
    'CLEAR_STOCK_SHORT',
    'EDIT_TRACKING',
]);

export const MAX_SECONDARY_BUTTONS = 2;

export const CLIENT_ACTION_IDS = [
    'RECORD_REMITTANCE',
    'PRINT_SLIP',
    'DOWNLOAD_INVOICE',
    'REISSUE_B2B',
    'EXCHANGE',
    'REVOKE_LINKS',
] as const;
export type ClientActionId = (typeof CLIENT_ACTION_IDS)[number];

export type ActionItem =
    | { kind: 'server'; code: OrderActionCode }
    | { kind: 'client'; code: ClientActionId };

/** What each server code opens (one dialog per code; PACK navigates). */
export const ACTION_DIALOG: Record<OrderActionCode, string> = {
    CONFIRM: 'confirmCod',
    PACK: 'navigatePack',
    SHIP: 'ship',
    DELIVER: 'deliver',
    RTO: 'rto',
    RTO_RECEIVE: 'rtoReceive',
    EDIT_TRACKING: 'editTracking',
    UNPACK: 'reason',
    UNDO_SHIP: 'reason',
    UNDO_DELIVERY: 'reason',
    CANCEL: 'cancelOrder',
    CANCEL_LINE: 'cancelLine',
    RECORD_RECEIPT: 'receipt',
    CLEAR_STOCK_SHORT: 'reason',
    CREATE_RETURN: 'createReturn',
    REFUND: 'refund',
};

const KNOWN: ReadonlySet<string> = new Set(ORDER_ACTION_CODES);

/** `next_actions` as known codes, in the server's order, without duplicates. */
export function serverActions(detail: Pick<StaffOrderDetail, 'next_actions'>): OrderActionCode[] {
    const seen = new Set<string>();
    return (detail.next_actions ?? []).filter((code): code is OrderActionCode => {
        if (!KNOWN.has(code) || seen.has(code)) return false;
        seen.add(code);
        return true;
    });
}

type AccessLike = Pick<CommerceAccess, 'hasAnyRole' | 'isManager'>;

const { STORE_MANAGER: M, WAREHOUSE_STAFF: W, ACCOUNTANT: AC } = COMMERCE_ROLE;

/** The shipment that is not cancelled (Phase 1: at most one). */
export function liveShipment(detail: Pick<StaffOrderDetail, 'shipments'>): StaffShipment | null {
    return (detail.shipments ?? []).find((shipment) => shipment.status !== 'CANCELLED') ?? null;
}

/** Item lines only (not shipping or COD charge lines). */
export function itemLines(detail: Pick<StaffOrderDetail, 'lines'>): StaffOrderLine[] {
    return (detail.lines ?? []).filter((line) =>
        line.line_type ? line.line_type.toUpperCase() === 'ITEM' : !!line.package_session_id
    );
}

/** Not yet cancelled or shipped. */
export function openQuantity(line: Pick<StaffOrderLine, 'quantity' | 'qty_cancelled' | 'qty_shipped'>): number {
    return Math.max(0, line.quantity - line.qty_cancelled - line.qty_shipped);
}

/** A return the customer can take as credit for a new order. */
export function exchangeableReturn(view: Pick<ReturnView, 'status' | 'due_raised' | 'refunded'>): boolean {
    const status = (view.status ?? '').toUpperCase();
    return (
        (status === 'RECEIVED' || status === 'CLOSED') &&
        (view.due_raised ?? 0) > (view.refunded ?? 0)
    );
}

export function clientActions(
    detail: StaffOrderDetail,
    access: AccessLike,
    returnViews: readonly ReturnView[] = []
): ClientActionId[] {
    const out: ClientActionId[] = [];
    const order = detail.order;
    if (
        (order.payment_method ?? '').toUpperCase() === 'COD' &&
        order.status === 'DELIVERED' &&
        (order.payment_status ?? '').toUpperCase() === 'UNPAID' &&
        !detail.cod_remittance_id &&
        access.hasAnyRole([M, AC])
    ) {
        out.push('RECORD_REMITTANCE');
    }
    if (liveShipment(detail) && access.hasAnyRole([M, W])) out.push('PRINT_SLIP');
    if (detail.invoice_id && access.hasAnyRole([M, AC])) out.push('DOWNLOAD_INVOICE');
    if (detail.invoice_id && !detail.buyer_gstin && access.isManager) out.push('REISSUE_B2B');
    if (access.isManager && returnViews.some(exchangeableReturn)) out.push('EXCHANGE');
    if (access.isManager) out.push('REVOKE_LINKS');
    return out;
}

export interface OrderButtons {
    primary: ActionItem | null;
    secondary: ActionItem[];
    overflow: ActionItem[];
}

export function orderButtons(
    detail: StaffOrderDetail,
    access: AccessLike,
    returnViews: readonly ReturnView[] = []
): OrderButtons {
    const codes = serverActions(detail);
    const present = new Set(codes);
    const primaryCode = PRIMARY_ORDER.find((code) => present.has(code)) ?? null;

    const secondaryCodes = [
        ...SECONDARY_ORDER.filter((code) => present.has(code)),
        ...PRIMARY_ORDER.filter((code) => present.has(code) && code !== primaryCode),
    ];
    const asButtons = secondaryCodes.slice(0, MAX_SECONDARY_BUTTONS);
    const spilled = secondaryCodes.slice(MAX_SECONDARY_BUTTONS);
    const overflowCodes = [...spilled, ...OVERFLOW_ORDER.filter((code) => present.has(code))];

    return {
        primary: primaryCode ? { kind: 'server', code: primaryCode } : null,
        secondary: asButtons.map((code) => ({ kind: 'server', code })),
        overflow: [
            ...overflowCodes.map((code): ActionItem => ({ kind: 'server', code })),
            ...clientActions(detail, access, returnViews).map(
                (code): ActionItem => ({ kind: 'client', code })
            ),
        ],
    };
}

/** Transition bodies of the reason-only codes (`from_status` is always the shown status). */
export const REASON_MOVES: Partial<Record<OrderActionCode, { from: string; to: string }>> = {
    UNPACK: { from: 'PACKED', to: 'CONFIRMED' },
    UNDO_SHIP: { from: 'SHIPPED', to: 'PACKED' },
    UNDO_DELIVERY: { from: 'DELIVERED', to: 'SHIPPED' },
};
