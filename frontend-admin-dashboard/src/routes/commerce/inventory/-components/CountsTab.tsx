import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Plus } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyPagination } from '@/components/design-system/pagination';
import { MyTable } from '@/components/design-system/table';
import { formatDateTime } from '@/lib/formatters';
import { CommerceEmptyState, CommerceLoadingRows, CommerceStatusChip } from '@/routes/commerce/-components/CommerceStates';
import { openCount } from '../-shared/inventory-api';
import { currentUserId, useCounts, useInvalidateInventory } from '../-shared/inventory-hooks';
import type { CountRow } from '../-shared/inventory-types';
import type { TabProps } from './InventoryPage';
import { InventoryErrorNotice, TOUCH } from './inventory-ui';
import { StartCountDialog } from './StartCountDialog';
import { useInventoryWrite } from './use-inventory-write';

const PAGE_SIZE = 50;

/**
 * A blind recount is offered only when the server offers it (`RECOUNT` in the
 * row's `next_actions`): never to anyone who started the count or saved a line
 * of it. An older server without `next_actions`: an open count started by
 * someone else.
 */
export const canRecount = (row: Pick<CountRow, 'kind' | 'status' | 'started_by' | 'next_actions'>, me: string | null): boolean =>
    row.next_actions
        ? row.next_actions.includes('RECOUNT')
        : row.kind === 'COUNT' && row.status === 'OPEN' && !!me && row.started_by !== me;

/** Counts tab (contract §7.3): counts and recounts, Start a count, Blind recount. */
export function CountsTab(props: TabProps) {
    const { t } = useTranslation('commerce');
    const navigate = useNavigate();
    const invalidate = useInvalidateInventory();
    const write = useInventoryWrite('cnt');
    const me = currentUserId();
    const [page, setPage] = useState(0);
    const [starting, setStarting] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const query = useCounts({ locationId: props.locationId ?? undefined, page, size: PAGE_SIZE });
    const rows = query.data?.rows ?? [];
    const total = query.data?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const recount = async (row: CountRow) => {
        setError(null);
        const body = { location_id: row.location?.id ?? '', kind: 'RECOUNT' as const, recount_of_count_id: row.id };
        try {
            await write.run({
                scope: `recount:${row.id}`,
                body,
                send: (id) => openCount({ ...body, client_request_id: id }),
                onDone: (view) => {
                    void invalidate();
                    void navigate({ to: '/commerce/inventory/counts/$countId', params: { countId: view.id } });
                },
            });
        } catch (e) {
            setError(e);
        }
    };

    const columns = useMemo<ColumnDef<CountRow>[]>(
        () => [
            {
                id: 'number',
                header: t('inventory.counts.number'),
                cell: ({ row }) => (
                    <Link
                        to="/commerce/inventory/counts/$countId"
                        params={{ countId: row.original.id }}
                        className="font-medium text-primary-500 hover:underline"
                    >
                        {row.original.count_number ?? row.original.id}
                    </Link>
                ),
            },
            {
                id: 'kind',
                header: t('inventory.counts.kind'),
                cell: ({ row }) => t(`inventory.counts.kinds.${row.original.kind === 'RECOUNT' ? 'RECOUNT' : 'COUNT'}`),
            },
            { id: 'status', header: t('inventory.transfers.status'), cell: ({ row }) => <CommerceStatusChip kind="stockCount" value={row.original.status} /> },
            { id: 'place', header: t('inventory.movements.place'), cell: ({ row }) => row.original.location?.name ?? '—' },
            {
                id: 'scope',
                header: t('inventory.counts.scope'),
                cell: ({ row }) => row.original.scope_collection?.name ?? t('inventory.counts.wholePlace'),
            },
            {
                id: 'started',
                header: t('inventory.counts.started'),
                cell: ({ row }) => (row.original.started_at ? formatDateTime(row.original.started_at) : '—'),
            },
            { id: 'lines', header: t('inventory.transfers.lines'), cell: ({ row }) => <span className="block text-end tabular-nums">{row.original.line_count}</span> },
            {
                id: 'posted',
                header: t('inventory.counts.posted'),
                cell: ({ row }) => (row.original.posted_at ? formatDateTime(row.original.posted_at) : '—'),
            },
            {
                id: 'actions',
                header: '',
                cell: ({ row }) =>
                    canRecount(row.original, me) ? (
                        <MyButton type="button" buttonType="secondary" scale="small" className="h-12 md:h-8" onAsyncClick={() => recount(row.original)}>
                            {t('inventory.counts.recount')}
                        </MyButton>
                    ) : null,
            },
        ],
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [t, me]
    );

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-body text-muted-foreground">{t('inventory.counts.tradingNote')}</p>
                <MyButton type="button" buttonType="primary" scale="large" className={TOUCH} onClick={() => setStarting(true)}>
                    <Plus size={16} />
                    {t('inventory.counts.start')}
                </MyButton>
            </div>
            <InventoryErrorNotice error={error} />
            {query.isLoading && <CommerceLoadingRows rows={4} />}
            {query.isError && <InventoryErrorNotice error={query.error} />}
            {query.isSuccess && rows.length === 0 && <CommerceEmptyState title={t('inventory.counts.empty')} />}
            {rows.length > 0 && (
                <>
                    <MyTable<CountRow>
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
            {starting && <StartCountDialog open onOpenChange={setStarting} {...props} />}
            {write.dialog}
        </div>
    );
}
