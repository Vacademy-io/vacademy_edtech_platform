import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Plus } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyPagination } from '@/components/design-system/pagination';
import { MyTable } from '@/components/design-system/table';
import { formatDateTime } from '@/lib/formatters';
import { PlainSelect } from '@/routes/commerce/-components/CatalogueBits';
import { CommerceEmptyState, CommerceLoadingRows, CommerceStatusChip } from '@/routes/commerce/-components/CommerceStates';
import { useInventoryAccess, useTransfers } from '../-shared/inventory-hooks';
import { TRANSFER_DIRECTIONS, TRANSFER_STATUSES, type TransferDirection, type TransferRow } from '../-shared/inventory-types';
import { ChallanSeriesCard } from './ChallanSeriesCard';
import type { TabProps } from './InventoryPage';
import { InventoryErrorNotice, placeLabel, TOUCH } from './inventory-ui';
import { NewTransferDialog } from './NewTransferDialog';

const PAGE_SIZE = 50;
/** Owner default (Q7): a transfer on the way longer than this is flagged. */
export const OVERDUE_DAYS = 7;

/** Transfers tab (contract §7.3): the list with status and direction filters, New transfer, challan numbering. */
export function TransfersTab(props: TabProps) {
    const { t } = useTranslation('commerce');
    const access = useInventoryAccess();
    const [status, setStatus] = useState('');
    const [direction, setDirection] = useState<TransferDirection>('ANY');
    const [page, setPage] = useState(0);
    const [creating, setCreating] = useState(false);
    const query = useTransfers({
        status: status || undefined,
        direction,
        locationId: props.locationId ?? undefined,
        page,
        size: PAGE_SIZE,
    });
    const rows = query.data?.rows ?? [];
    const total = query.data?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const columns = useMemo<ColumnDef<TransferRow>[]>(
        () => [
            {
                id: 'number',
                header: t('inventory.transfers.number'),
                cell: ({ row }) => (
                    <Link
                        to="/commerce/inventory/transfers/$transferId"
                        params={{ transferId: row.original.id }}
                        className="font-medium text-primary-500 hover:underline"
                    >
                        {row.original.transfer_number ?? row.original.id}
                    </Link>
                ),
            },
            {
                id: 'route',
                header: `${t('inventory.transfers.from')} → ${t('inventory.transfers.to')}`,
                cell: ({ row }) => (
                    <span className="text-body">
                        {placeLabel(row.original.from)} → {placeLabel(row.original.to)}
                    </span>
                ),
            },
            {
                id: 'status',
                header: t('inventory.transfers.status'),
                cell: ({ row }) => (
                    <div className="flex flex-wrap gap-1">
                        <CommerceStatusChip kind="transfer" value={row.original.status} />
                        {row.original.overdue && (
                            <span className="rounded-sm bg-warning-50 px-1 text-caption text-warning-600">
                                {t('inventory.transfers.overdue', { days: OVERDUE_DAYS })}
                            </span>
                        )}
                    </div>
                ),
            },
            { id: 'challan', header: t('inventory.transfers.challan'), cell: ({ row }) => row.original.document_number ?? '—' },
            {
                id: 'lines',
                header: t('inventory.transfers.lines'),
                cell: ({ row }) => <span className="block text-end tabular-nums">{row.original.line_count}</span>,
            },
            {
                id: 'qty',
                header: t('inventory.transfers.quantity'),
                cell: ({ row }) => <span className="block text-end tabular-nums">{row.original.qty_sent}</span>,
            },
            {
                id: 'created',
                header: t('inventory.transfers.created'),
                cell: ({ row }) => (row.original.created_at ? formatDateTime(row.original.created_at) : '—'),
            },
            {
                id: 'dispatched',
                header: t('inventory.transfers.dispatched'),
                cell: ({ row }) => (row.original.dispatched_at ? formatDateTime(row.original.dispatched_at) : '—'),
            },
            {
                id: 'received',
                header: t('inventory.transfers.received'),
                cell: ({ row }) => (row.original.received_at ? formatDateTime(row.original.received_at) : '—'),
            },
        ],
        [t]
    );

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="grid flex-1 grid-cols-1 gap-3 sm:max-w-xl sm:grid-cols-2">
                    <PlainSelect
                        label={t('inventory.transfers.status')}
                        value={status}
                        noneLabel={t('inventory.transfers.allStatuses')}
                        onChange={(value) => {
                            setStatus(value);
                            setPage(0);
                        }}
                        options={TRANSFER_STATUSES.map((value) => ({ value, label: t(`status.transfer.${value}`) }))}
                    />
                    <PlainSelect
                        label={t('inventory.transfers.direction')}
                        value={direction}
                        onChange={(value) => {
                            setDirection((value || 'ANY') as TransferDirection);
                            setPage(0);
                        }}
                        options={TRANSFER_DIRECTIONS.map((value) => ({ value, label: t(`inventory.transfers.directions.${value}`) }))}
                    />
                </div>
                <MyButton type="button" buttonType="primary" scale="large" className={TOUCH} onClick={() => setCreating(true)}>
                    <Plus size={16} />
                    {t('inventory.transfers.new')}
                </MyButton>
            </div>
            {query.isLoading && <CommerceLoadingRows rows={4} />}
            {query.isError && <InventoryErrorNotice error={query.error} />}
            {query.isSuccess && rows.length === 0 && <CommerceEmptyState title={t('inventory.transfers.empty')} />}
            {rows.length > 0 && (
                <>
                    <MyTable<TransferRow>
                        data={{
                            content: rows,
                            page_no: page,
                            page_size: PAGE_SIZE,
                            total_elements: total,
                            total_pages: totalPages,
                            last: page + 1 >= totalPages,
                        }}
                        columns={columns}
                        isLoading={false}
                        error={null}
                        currentPage={page}
                        scrollable
                    />
                    <MyPagination
                        currentPage={page}
                        totalPages={totalPages}
                        totalElements={total}
                        pageSize={PAGE_SIZE}
                        onPageChange={setPage}
                        compactOnPhone
                    />
                </>
            )}
            {access.isManager && <ChallanSeriesCard places={props.places} />}
            {creating && <NewTransferDialog open onOpenChange={setCreating} {...props} />}
        </div>
    );
}
