import { useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { MoneyCell } from '@/components/design-system/money-cell';
import { MyPagination } from '@/components/design-system/pagination';
import { MyTable } from '@/components/design-system/table';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { formatDateTime } from '@/lib/formatters';
import { PlainSelect } from '@/routes/commerce/-components/CatalogueBits';
import { CommercePage } from '@/routes/commerce/-components/CommercePage';
import {
    CommerceEmptyState,
    CommerceLoadingRows,
    CommerceNoAccessCard,
    CommerceStatusChip,
} from '@/routes/commerce/-components/CommerceStates';
import { inputClass } from '@/routes/commerce/orders/-components/order-ui';
import { useRegisters, useSessions } from '../-shared/pos-hooks';
import type { SessionRow } from '../-shared/pos-types';
import { PosErrorNotice } from './pos-ui';

const PAGE_SIZE = 50;

/** P7 (contract §7.3): every counter session of the shop, newest first (manager). */
export function PosSessionsPage() {
    const { t } = useTranslation('commerce');
    const access = useCommerceAccess();
    return (
        <CommercePage
            navId="commerce-pos"
            title={t('pos.sessions.title')}
            description={t('pos.sessions.description')}
            backTo={{ to: '/commerce/pos', label: t('pos.title') }}
        >
            {access.isResolved && !access.isManager ? <CommerceNoAccessCard className="mt-8" /> : <SessionsList />}
        </CommercePage>
    );
}

function SessionsList() {
    const { t } = useTranslation('commerce');
    const navigate = useNavigate();
    const search = useSearch({ from: '/commerce/pos/sessions/' });
    const page = Math.max(0, (search.page ?? 1) - 1);
    const filters = {
        registerId: search.registerId,
        status: search.status,
        from: search.from,
        to: search.to,
        page,
        pageSize: PAGE_SIZE,
    };
    const query = useSessions(filters);
    const registers = useRegisters();
    const rows = query.data?.rows ?? [];
    const total = query.data?.total ?? 0;

    const setSearch = (next: Record<string, string | number | undefined>) =>
        void navigate({
            to: '/commerce/pos/sessions',
            search: (previous: Record<string, unknown>) => ({ ...previous, ...next }),
            replace: true,
        });

    const columns = useMemo<ColumnDef<SessionRow>[]>(
        () => [
            {
                id: 'register',
                header: t('pos.sessions.register'),
                cell: ({ row }) => (
                    <Link
                        to="/commerce/pos/sessions/$sessionId"
                        params={{ sessionId: row.original.id }}
                        className="font-medium text-primary-500 hover:underline"
                    >
                        {row.original.register_code}
                        <span className="block text-caption text-muted-foreground">{row.original.location_name}</span>
                    </Link>
                ),
            },
            {
                id: 'cashier',
                header: t('pos.sessions.cashier'),
                cell: ({ row }) =>
                    row.original.cashier_name ?? '—',
            },
            {
                id: 'opened',
                header: t('pos.z.opened'),
                cell: ({ row }) => (row.original.opened_at ? formatDateTime(row.original.opened_at) : '—'),
            },
            {
                id: 'closed',
                header: t('pos.z.closed'),
                cell: ({ row }) => (row.original.closed_at ? formatDateTime(row.original.closed_at) : '—'),
            },
            {
                id: 'bills',
                header: t('pos.sessions.bills'),
                cell: ({ row }) => <span className="block text-end tabular-nums">{row.original.bills_count}</span>,
            },
            {
                id: 'total',
                header: t('pos.totals.total'),
                cell: ({ row }) => <MoneyCell value={row.original.bills_total} />,
            },
            {
                id: 'variance',
                header: t('pos.close.difference'),
                cell: ({ row }) =>
                    row.original.variance === null ? (
                        <span className="block text-end text-neutral-400">—</span>
                    ) : (
                        <MoneyCell value={row.original.variance} tone={row.original.variance ? 'deduction' : 'default'} />
                    ),
            },
            {
                id: 'status',
                header: t('pos.bills.status'),
                cell: ({ row }) => <CommerceStatusChip kind="posSession" value={row.original.status} />,
            },
        ],
        [t]
    );

    return (
        <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <PlainSelect
                    label={t('pos.sessions.register')}
                    value={search.registerId ?? ''}
                    onChange={(value) => setSearch({ registerId: value || undefined, page: undefined })}
                    noneLabel={t('pos.sessions.allRegisters')}
                    options={(registers.data ?? []).map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` }))}
                />
                <PlainSelect
                    label={t('pos.bills.status')}
                    value={search.status ?? ''}
                    onChange={(value) => setSearch({ status: value || undefined, page: undefined })}
                    noneLabel={t('pos.sessions.allStatuses')}
                    options={(['OPEN', 'CLOSED'] as const).map((s) => ({ value: s, label: t(`status.posSession.${s}`) }))}
                />
                <label className="flex flex-col gap-1.5 text-caption text-muted-foreground">
                    {t('orders.filters.from')}
                    <input
                        type="date"
                        className={inputClass}
                        value={search.from ?? ''}
                        onChange={(event) => setSearch({ from: event.target.value || undefined, page: undefined })}
                    />
                </label>
                <label className="flex flex-col gap-1.5 text-caption text-muted-foreground">
                    {t('orders.filters.to')}
                    <input
                        type="date"
                        className={inputClass}
                        value={search.to ?? ''}
                        onChange={(event) => setSearch({ to: event.target.value || undefined, page: undefined })}
                    />
                </label>
            </div>
            {query.isLoading && <CommerceLoadingRows rows={5} />}
            {query.isError && <PosErrorNotice error={query.error} />}
            {query.isSuccess && rows.length === 0 && <CommerceEmptyState title={t('pos.sessions.empty')} />}
            {rows.length > 0 && (
                <>
                    <MyTable<SessionRow>
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
