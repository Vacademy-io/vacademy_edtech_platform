import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { DownloadSimple, Package, Plus, Wallet } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyPagination } from '@/components/design-system/pagination';
import type { TableData } from '@/components/design-system/table';
import { COMMERCE_ROLE } from '@/lib/commerce/commerce-access';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { CommercePage } from '@/routes/commerce/-components/CommercePage';
import {
    CommerceEmptyState,
    CommerceErrorState,
    CommerceLoadingRows,
} from '@/routes/commerce/-components/CommerceStates';
import { readOrderError } from '@/routes/commerce/orders/-shared/order-errors';
import { useOrderList } from '@/routes/commerce/orders/-shared/order-hooks';
import {
    ORDER_PAGE_SIZE,
    type OrderFilters as DeskFilters,
    type RowAction,
    bulkActionsFor,
    isFiltered,
    queueDefinition,
    resolveQueue,
    rowActionFor,
    visibleQueues,
} from '@/routes/commerce/orders/-shared/order-queues';
import type { OrderQueue, StaffOrderRow } from '@/routes/commerce/orders/-shared/order-types';
import { OrderRowActionDialog, type RowDialogAction } from './OrderActionBar';
import { OrderBulkBar, exportOrders } from './OrderBulkBar';
import { type DeskFilterValue, OrderFilters } from './OrderFilters';
import { OrderQueueTabs } from './OrderQueueTabs';
import { OrdersTable } from './OrdersTable';
import { useOrderErrorText } from './order-ui';

export interface OrdersSearchState {
    queue?: string;
    q?: string;
    /** 1-based in the address. */
    page?: number;
    from?: string;
    to?: string;
    channel?: string;
    method?: string;
}

const { STORE_MANAGER: M, WAREHOUSE_STAFF: W, ACCOUNTANT: AC } = COMMERCE_ROLE;

/**
 * S1 Order desk: queue tabs with counts, search and filters, the order list,
 * row buttons and the bulk bar. Tab, search, filters and page live in the
 * address, so deep links and Back work.
 */
export function OrdersPage({
    search,
    onSearchChange,
}: {
    search: OrdersSearchState;
    onSearchChange: (next: OrdersSearchState) => void;
}) {
    const { t } = useTranslation('commerce');
    const navigate = useNavigate();
    const access = useCommerceAccess();
    const ready = access.isResolved;
    return (
        <CommercePage
            navId="commerce-orders"
            title={t('orders.title')}
            description={t('orders.description')}
            actions={
                ready ? (
                    <>
                        {access.hasAnyRole([M, W]) && (
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="medium"
                                onClick={() => void navigate({ to: '/commerce/orders/pack' as never })}
                            >
                                <Package size={16} />
                                {t('orders.packStation')}
                            </MyButton>
                        )}
                        {access.hasAnyRole([M, AC]) && (
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="medium"
                                onClick={() => void navigate({ to: '/commerce/orders/remittances' as never })}
                            >
                                <Wallet size={16} />
                                {t('orders.remittances')}
                            </MyButton>
                        )}
                        {access.isManager && (
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="medium"
                                onClick={() => void navigate({ to: '/commerce/orders/new' as never })}
                            >
                                <Plus size={16} />
                                {t('orders.newOrder')}
                            </MyButton>
                        )}
                    </>
                ) : undefined
            }
        >
            <OrdersDesk search={search} onSearchChange={onSearchChange} />
        </CommercePage>
    );
}

function OrdersDesk({
    search,
    onSearchChange,
}: {
    search: OrdersSearchState;
    onSearchChange: (next: OrdersSearchState) => void;
}) {
    const { t } = useTranslation('commerce');
    const navigate = useNavigate();
    const access = useCommerceAccess();
    const errorText = useOrderErrorText();
    const enabled = access.isResolved && access.canOpen('commerce-orders');

    const queues = useMemo(() => visibleQueues(access), [access]);
    const queue: OrderQueue = resolveQueue(search.queue, access);
    const definition = queueDefinition(queue) ?? queues[0];
    const page = Math.max(0, (search.page ?? 1) - 1);

    const filters = useMemo<DeskFilters>(
        () => ({
            queue,
            q: search.q ?? '',
            from: search.from ?? '',
            to: search.to ?? '',
            channel: search.channel ?? '',
            method: search.method ?? '',
            page,
        }),
        [queue, search.q, search.from, search.to, search.channel, search.method, page]
    );
    const list = useOrderList(filters, enabled);
    const filtered = isFiltered(filters);

    const [selected, setSelected] = useState<Record<string, boolean>>({});
    const [rowDialog, setRowDialog] = useState<{ orderId: string; action: RowDialogAction } | null>(null);
    const [now, setNow] = useState(() => Date.now());

    // The age column moves on while the desk is open.
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 60 * 1000);
        return () => clearInterval(timer);
    }, []);

    // Another tab, page or filter starts with nothing ticked.
    useEffect(() => setSelected({}), [filters]);

    const change = useCallback(
        (next: Partial<OrdersSearchState>, keepPage = false) => {
            const merged: OrdersSearchState = { ...search, ...next };
            if (!keepPage) merged.page = undefined;
            const clean = Object.fromEntries(
                Object.entries(merged).filter(([, value]) => value !== '' && value !== undefined)
            ) as OrdersSearchState;
            onSearchChange(clean);
        },
        [search, onSearchChange]
    );

    const onFilters = useCallback((next: Partial<DeskFilterValue>) => change(next), [change]);

    const rows = useMemo(() => list.data?.orders ?? [], [list.data]);
    const tableData = useMemo<TableData<StaffOrderRow>>(() => {
        const total = list.data?.total ?? 0;
        return {
            content: rows,
            total_pages: Math.max(1, Math.ceil(total / ORDER_PAGE_SIZE)),
            page_no: page,
            page_size: ORDER_PAGE_SIZE,
            total_elements: total,
            last: (page + 1) * ORDER_PAGE_SIZE >= total,
        };
    }, [rows, list.data, page]);

    const bulkActions = bulkActionsFor(queue, access);
    const rowAction = rowActionFor(queue, access);
    const selectedRows = rows.filter((row) => selected[row.id]);

    const openOrder = (row: StaffOrderRow) =>
        void navigate({ to: '/commerce/orders/$orderId', params: { orderId: row.id } });

    const onRowAction = (row: StaffOrderRow, action: RowAction) => {
        switch (action) {
            case 'PACK':
                void navigate({ to: '/commerce/orders/pack', search: { order: row.id } as never });
                return;
            case 'RTO_RECEIVE':
                void navigate({
                    to: '/commerce/orders/$orderId',
                    params: { orderId: row.id },
                    search: { action: 'RTO_RECEIVE' } as never,
                });
                return;
            case 'OPEN':
                openOrder(row);
                return;
            default:
                setRowDialog({ orderId: row.id, action });
        }
    };

    const exportPage = () =>
        void exportOrders(rows).catch(() => toast.error(t('orders.errors.generic')));

    return (
        <div className="flex flex-col gap-4">
            <OrderQueueTabs
                queues={queues}
                active={queue}
                onChange={(next) => change({ queue: next })}
                enabled={enabled}
            />
            <OrderFilters
                value={{
                    q: filters.q ?? '',
                    from: filters.from ?? '',
                    to: filters.to ?? '',
                    channel: filters.channel ?? '',
                    method: filters.method ?? '',
                }}
                onChange={onFilters}
                filtered={filtered}
                trailing={
                    bulkActions.includes('EXPORT') && selectedRows.length === 0 && rows.length > 0 ? (
                        <MyButton type="button" buttonType="secondary" scale="small" onClick={exportPage}>
                            <DownloadSimple size={14} />
                            {t('orders.bulk.exportPage')}
                        </MyButton>
                    ) : undefined
                }
            />

            {selectedRows.length > 0 && bulkActions.length > 0 && (
                <OrderBulkBar
                    actions={bulkActions}
                    selected={selectedRows}
                    onClear={() => setSelected({})}
                    onUntickDone={(ids) =>
                        setSelected((current) => {
                            const next = { ...current };
                            ids.forEach((id) => delete next[id]);
                            return next;
                        })
                    }
                />
            )}

            {list.isLoading && <CommerceLoadingRows rows={6} />}
            {list.isError && !list.data && (
                <CommerceErrorState
                    message={`${t('orders.list.loadFailed')} ${errorText(readOrderError(list.error))}`}
                    onRetry={() => void list.refetch()}
                />
            )}
            {list.isSuccess && rows.length === 0 && (
                <CommerceEmptyState
                    title={filtered ? t('orders.empty.filteredTitle') : t(`orders.empty.${queue}`)}
                    description={filtered ? t('orders.empty.filteredDescription') : t('orders.empty.hint')}
                >
                    {filtered && (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => change({ q: '', from: '', to: '', channel: '', method: '' })}
                        >
                            {t('orders.empty.clearFilters')}
                        </MyButton>
                    )}
                </CommerceEmptyState>
            )}
            {list.data && rows.length > 0 && definition && (
                <>
                    <OrdersTable
                        data={tableData}
                        queue={definition}
                        page={page}
                        selectable={bulkActions.length > 0}
                        selected={selected}
                        onToggle={(id, on) => setSelected((current) => ({ ...current, [id]: on }))}
                        onToggleAll={(on) =>
                            setSelected(on ? Object.fromEntries(rows.map((row) => [row.id, true])) : {})
                        }
                        rowAction={rowAction}
                        onRowAction={onRowAction}
                        onOpen={openOrder}
                        now={now}
                    />
                    <MyPagination
                        currentPage={page}
                        totalPages={tableData.total_pages}
                        totalElements={tableData.total_elements}
                        pageSize={ORDER_PAGE_SIZE}
                        onPageChange={(next) => change({ page: next + 1 }, true)}
                        compactOnPhone
                    />
                </>
            )}

            {rowDialog && (
                <OrderRowActionDialog
                    orderId={rowDialog.orderId}
                    action={rowDialog.action}
                    onClose={() => setRowDialog(null)}
                />
            )}
        </div>
    );
}
