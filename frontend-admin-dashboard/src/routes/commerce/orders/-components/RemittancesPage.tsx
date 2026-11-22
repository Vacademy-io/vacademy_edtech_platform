import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Plus } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MoneyCell } from '@/components/design-system/money-cell';
import { MyPagination } from '@/components/design-system/pagination';
import { MyTable } from '@/components/design-system/table';
import { COMMERCE_ROLE } from '@/lib/commerce/commerce-access';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { formatDate } from '@/lib/formatters';
import { CommercePage } from '@/routes/commerce/-components/CommercePage';
import {
    CommerceEmptyState,
    CommerceErrorState,
    CommerceLoadingRows,
    CommerceNoAccessCard,
} from '@/routes/commerce/-components/CommerceStates';
import { readOrderError } from '@/routes/commerce/orders/-shared/order-errors';
import { useRemittances } from '@/routes/commerce/orders/-shared/order-hooks';
import type { RemittanceView } from '@/routes/commerce/orders/-shared/order-types';
import { RemittanceDialog } from './dialogs/RemittanceDialog';
import { Field, inputClass, useOrderErrorText } from './order-ui';

const PAGE_SIZE = 20;
const { STORE_MANAGER: M, ACCOUNTANT: AC } = COMMERCE_ROLE;

/**
 * COD remittances (contract §5.6.2, S5): what the couriers paid over for cash
 * on delivery, and the form to record a new payment. Store manager and
 * accountant (and the institute ADMIN).
 */
export function RemittancesPage() {
    const { t } = useTranslation('commerce');
    const access = useCommerceAccess();
    const allowed = access.isResolved && access.hasAnyRole([M, AC]);
    const [open, setOpen] = useState(false);
    return (
        <CommercePage
            navId="commerce-orders"
            title={t('orders.remittances')}
            description={t('orders.remittance.pageDescription')}
            backTo={{ to: '/commerce/orders', label: t('orders.backToDesk') }}
            actions={
                allowed ? (
                    <MyButton type="button" buttonType="primary" scale="medium" onClick={() => setOpen(true)}>
                        <Plus size={16} />
                        {t('orders.actions.RECORD_REMITTANCE')}
                    </MyButton>
                ) : undefined
            }
        >
            {access.isResolved && !allowed ? (
                <CommerceNoAccessCard className="mt-8" />
            ) : allowed ? (
                <>
                    <RemittancesList />
                    <RemittanceDialog open={open} onOpenChange={setOpen} />
                </>
            ) : null}
        </CommercePage>
    );
}

function RemittancesList() {
    const { t } = useTranslation('commerce');
    const errorText = useOrderErrorText();
    const navigate = useNavigate();
    const search = useSearch({ from: '/commerce/orders/remittances/' });
    const page = Math.max(0, (search.page ?? 1) - 1);
    const filters = { from: search.from, to: search.to, page, pageSize: PAGE_SIZE };
    const query = useRemittances(filters);
    const filtered = !!(search.from || search.to);

    const setSearch = (next: { from?: string; to?: string; page?: number }) =>
        void navigate({
            to: '/commerce/orders/remittances',
            search: (previous: Record<string, unknown>) => ({ ...previous, ...next }),
            replace: true,
        } as never);

    const rows = query.data?.items ?? [];
    const total = query.data?.total ?? 0;

    const columns: ColumnDef<RemittanceView>[] = [
        {
            id: 'reference',
            header: t('orders.remittance.reference'),
            size: 180,
            cell: ({ row }) => (
                <span className="text-body font-medium text-foreground">{row.original.reference ?? '—'}</span>
            ),
        },
        {
            id: 'courier',
            header: t('orders.ship.courier'),
            size: 140,
            cell: ({ row }) => <span className="text-body">{row.original.courier_name ?? '—'}</span>,
        },
        {
            id: 'receivedOn',
            header: t('orders.remittance.receivedOn'),
            size: 120,
            cell: ({ row }) => (
                <span className="text-body">
                    {row.original.received_on ? formatDate(row.original.received_on) : '—'}
                </span>
            ),
        },
        {
            id: 'orders',
            header: t('orders.remittance.orderCount'),
            size: 90,
            cell: ({ row }) => (
                <span className="block text-end text-body tabular-nums">{row.original.order_count ?? '—'}</span>
            ),
        },
        {
            id: 'gross',
            header: t('orders.remittance.gross'),
            size: 120,
            cell: ({ row }) => <MoneyCell value={row.original.gross_amount} />,
        },
        {
            id: 'deductions',
            header: t('orders.remittance.deductions'),
            size: 120,
            cell: ({ row }) => <MoneyCell value={row.original.deductions} dashOnZero />,
        },
        {
            id: 'net',
            header: t('orders.remittance.net'),
            size: 120,
            cell: ({ row }) => <MoneyCell value={row.original.net_amount} />,
        },
        {
            id: 'difference',
            header: t('orders.remittance.differenceReason'),
            size: 200,
            cell: ({ row }) => (
                <span className="text-caption text-muted-foreground">{row.original.difference_reason ?? '—'}</span>
            ),
        },
    ];

    return (
        <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-card p-3 sm:max-w-md">
                <Field label={t('orders.filters.from')} htmlFor="remit-from">
                    <input
                        id="remit-from"
                        type="date"
                        className={inputClass}
                        value={search.from ?? ''}
                        onChange={(event) => setSearch({ from: event.target.value || undefined, page: undefined })}
                    />
                </Field>
                <Field label={t('orders.filters.to')} htmlFor="remit-to">
                    <input
                        id="remit-to"
                        type="date"
                        className={inputClass}
                        value={search.to ?? ''}
                        onChange={(event) => setSearch({ to: event.target.value || undefined, page: undefined })}
                    />
                </Field>
            </div>
            {query.isLoading && <CommerceLoadingRows rows={5} />}
            {query.isError && (
                <CommerceErrorState
                    message={errorText(readOrderError(query.error))}
                    onRetry={() => void query.refetch()}
                />
            )}
            {query.isSuccess && rows.length === 0 && (
                <CommerceEmptyState
                    title={filtered ? t('orders.empty.filteredTitle') : t('orders.remittance.empty')}
                >
                    {filtered && (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => setSearch({ from: undefined, to: undefined, page: undefined })}
                        >
                            {t('orders.empty.clearFilters')}
                        </MyButton>
                    )}
                </CommerceEmptyState>
            )}
            {query.isSuccess && rows.length > 0 && (
                <>
                    <MyTable<RemittanceView>
                        fillContainer
                        enableColumnResizing={false}
                        data={{
                            content: rows,
                            page_no: page,
                            page_size: PAGE_SIZE,
                            total_elements: total,
                            total_pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
                            last: (page + 1) * PAGE_SIZE >= total,
                        }}
                        columns={columns}
                        isLoading={false}
                        error={null}
                        currentPage={page}
                        scrollable
                    />
                    <MyPagination
                        currentPage={page}
                        totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
                        totalElements={total}
                        pageSize={PAGE_SIZE}
                        onPageChange={(next) => setSearch({ page: next + 1 })}
                        compactOnPhone
                    />
                </>
            )}
        </div>
    );
}
