import { useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Warning } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MoneyCell } from '@/components/design-system/money-cell';
import { MyTable, type TableData } from '@/components/design-system/table';
import { Checkbox } from '@/components/ui/checkbox';
import { formatDateTime } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { CommerceStatusChip } from '@/routes/commerce/-components/CommerceStates';
import {
    ageSince,
    channelLabel,
    codToCollect,
    formatAge,
    isLate,
    paymentLabel,
    rowDue,
} from '@/routes/commerce/orders/-shared/order-format';
import type { QueueDefinition, RowAction } from '@/routes/commerce/orders/-shared/order-queues';
import type { StaffOrderRow } from '@/routes/commerce/orders/-shared/order-types';

const ROW_ACTION_LABEL: Record<RowAction, string> = {
    CONFIRM: 'orders.actions.CONFIRM',
    PACK: 'orders.actions.PACK',
    SHIP: 'orders.actions.SHIP',
    DELIVER: 'orders.actions.DELIVER',
    RTO_RECEIVE: 'orders.actions.RTO_RECEIVE',
    RECORD_RECEIPT: 'orders.actions.RECORD_RECEIPT',
    OPEN: 'orders.actions.OPEN',
};

export interface OrdersTableProps {
    data: TableData<StaffOrderRow>;
    queue: QueueDefinition;
    page: number;
    selectable: boolean;
    selected: Record<string, boolean>;
    onToggle: (id: string, on: boolean) => void;
    onToggleAll: (on: boolean) => void;
    rowAction: RowAction | null;
    onRowAction: (row: StaffOrderRow, action: RowAction) => void;
    onOpen: (row: StaffOrderRow) => void;
    now: number;
}

/**
 * The desk's order list: a table from `md`, cards on a phone. Every row opens
 * the order; the row's own button (the tab's main step) stops the click there.
 */
export function OrdersTable(props: OrdersTableProps) {
    const { t } = useTranslation('commerce');
    const { data, queue, selectable, selected, onToggle, onToggleAll, rowAction, onRowAction, onOpen, now } =
        props;
    const rows = data.content;
    const allTicked = rows.length > 0 && rows.every((row) => selected[row.id]);

    const tick = (row: StaffOrderRow) => (
        <Checkbox
            checked={selected[row.id] === true}
            aria-label={t('orders.list.select', { number: row.order_number })}
            onClick={(event) => event.stopPropagation()}
            onCheckedChange={(checked) => onToggle(row.id, checked === true)}
        />
    );

    const numberLink = (row: StaffOrderRow) => (
        <Link
            to="/commerce/orders/$orderId"
            params={{ orderId: row.id }}
            onClick={(event) => event.stopPropagation()}
            className="text-body font-medium text-primary-500 hover:underline"
        >
            {row.order_number}
        </Link>
    );

    const customer = (row: StaffOrderRow) => (
        <div className="flex min-w-0 flex-col">
            <span className="truncate text-body text-foreground">{row.customer_name ?? '—'}</span>
            {row.customer_phone && (
                <a
                    href={`tel:${row.customer_phone}`}
                    onClick={(event) => event.stopPropagation()}
                    className="text-caption text-primary-500 hover:underline"
                >
                    {row.customer_phone}
                </a>
            )}
        </div>
    );

    const payment = (row: StaffOrderRow) => (
        <div className="flex flex-col items-start gap-1">
            <span className="text-caption text-muted-foreground">{paymentLabel(row, t)}</span>
            {row.payment_status && <CommerceStatusChip kind="paymentStatus" value={row.payment_status} />}
        </div>
    );

    const status = (row: StaffOrderRow) => (
        <div className="flex flex-wrap items-center gap-1">
            <CommerceStatusChip kind="order" value={row.status} />
            {row.shipment_status === 'RTO_RECEIVED' && (
                <CommerceStatusChip kind="shipment" value={row.shipment_status} />
            )}
            {row.stock_short && (
                <span
                    role="img"
                    title={t('orders.list.stockShort')}
                    aria-label={t('orders.list.stockShort')}
                    className="text-warning-600"
                >
                    <Warning size={16} weight="fill" />
                </span>
            )}
        </div>
    );

    const age = (row: StaffOrderRow) => {
        const late = isLate(row, now);
        return (
            <span className={cn('text-caption tabular-nums', late ? 'text-danger-600' : 'text-muted-foreground')}>
                {formatAge(ageSince(row.status_since, now), t)}
                {late && <span className="sr-only"> · {t('orders.list.late')}</span>}
            </span>
        );
    };

    const extra = (row: StaffOrderRow) => {
        switch (queue.extraColumn) {
            case 'tracking':
                return <span className="text-caption text-foreground">{row.tracking_number ?? '—'}</span>;
            case 'codToCollect':
                return <MoneyCell value={codToCollect(row)} currency={row.currency} />;
            case 'due':
                return <MoneyCell value={rowDue(row)} currency={row.currency} />;
            case 'refundOpen':
                return <MoneyCell value={row.refund_open ?? 0} currency={row.currency} />;
            case 'returnState':
                return row.return_state ? <CommerceStatusChip kind="return" value={row.return_state} /> : <span>—</span>;
            default:
                return null;
        }
    };

    const actionButton = (row: StaffOrderRow) =>
        rowAction ? (
            <MyButton
                type="button"
                buttonType={rowAction === 'OPEN' ? 'secondary' : 'primary'}
                scale="small"
                onClick={(event) => {
                    event.stopPropagation();
                    onRowAction(row, rowAction);
                }}
            >
                {t(ROW_ACTION_LABEL[rowAction])}
            </MyButton>
        ) : null;

    const columns = useMemo<ColumnDef<StaffOrderRow>[]>(() => {
        const list: ColumnDef<StaffOrderRow>[] = [];
        if (selectable) {
            list.push({
                id: 'select',
                size: 44,
                header: () => (
                    <Checkbox
                        checked={allTicked}
                        aria-label={t('orders.list.selectAll')}
                        onCheckedChange={(checked) => onToggleAll(checked === true)}
                    />
                ),
                cell: ({ row }) => tick(row.original),
            });
        }
        list.push(
            { id: 'number', header: t('orders.list.columns.number'), size: 130, cell: ({ row }) => numberLink(row.original) },
            {
                id: 'placed',
                header: t('orders.list.columns.placed'),
                size: 150,
                cell: ({ row }) => (
                    <span className="text-caption text-muted-foreground">
                        {row.original.created_at ? formatDateTime(row.original.created_at) : '—'}
                    </span>
                ),
            },
            { id: 'customer', header: t('orders.list.columns.customer'), size: 180, cell: ({ row }) => customer(row.original) },
            {
                id: 'total',
                header: t('orders.list.columns.total'),
                size: 110,
                cell: ({ row }) => <MoneyCell value={row.original.total} currency={row.original.currency} />,
            },
            { id: 'payment', header: t('orders.list.columns.payment'), size: 150, cell: ({ row }) => payment(row.original) },
            { id: 'status', header: t('orders.list.columns.status'), size: 160, cell: ({ row }) => status(row.original) },
            {
                id: 'channel',
                header: t('orders.list.columns.channel'),
                size: 100,
                cell: ({ row }) => <span className="text-caption text-foreground">{channelLabel(row.original.channel, t)}</span>,
            },
            { id: 'age', header: t('orders.list.columns.age'), size: 120, cell: ({ row }) => age(row.original) }
        );
        if (queue.extraColumn) {
            list.push({
                id: 'extra',
                header: t(`orders.list.columns.${queue.extraColumn}`),
                size: 120,
                cell: ({ row }) => extra(row.original),
            });
        }
        if (rowAction) {
            list.push({ id: 'action', header: t('orders.list.columns.action'), size: 150, cell: ({ row }) => actionButton(row.original) });
        }
        return list;
        // The cell renderers read the latest props on every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectable, allTicked, queue, rowAction, selected, now, t]);

    return (
        <>
            {/* Phones: one card per order. */}
            <ul className="flex flex-col gap-2 md:hidden">
                {selectable && (
                    <li className="flex items-center gap-2 px-1 text-caption text-muted-foreground">
                        <Checkbox
                            checked={allTicked}
                            aria-label={t('orders.list.selectAll')}
                            onCheckedChange={(checked) => onToggleAll(checked === true)}
                        />
                        {t('orders.list.selectAll')}
                    </li>
                )}
                {rows.map((row) => (
                    <li
                        key={row.id}
                        className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3"
                        onClick={() => onOpen(row)}
                    >
                        {selectable && <div className="pt-1">{tick(row)}</div>}
                        <div className="flex min-w-0 flex-1 flex-col gap-2">
                            <div className="flex items-center justify-between gap-2">
                                {numberLink(row)}
                                <MoneyCell value={row.total} currency={row.currency} />
                            </div>
                            {customer(row)}
                            {status(row)}
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                {payment(row)}
                                {age(row)}
                                {queue.extraColumn && extra(row)}
                            </div>
                            {rowAction && <div>{actionButton(row)}</div>}
                        </div>
                    </li>
                ))}
            </ul>
            <div className="hidden md:block">
                <MyTable<StaffOrderRow>
                    fillContainer
                    enableColumnResizing={false}
                    data={data}
                    columns={columns}
                    isLoading={false}
                    error={null}
                    currentPage={props.page}
                    scrollable
                    onCellClick={(row, column) => {
                        if (column.id !== 'select' && column.id !== 'action') onOpen(row);
                    }}
                />
            </div>
        </>
    );
}
