import { useEffect, useMemo, useRef, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { MoneyCell } from '@/components/design-system/money-cell';
import { MyPagination } from '@/components/design-system/pagination';
import { MyTable, type TableData } from '@/components/design-system/table';
import { formatDate } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { CommercePage } from '@/routes/commerce/-components/CommercePage';
import {
    CommerceComingSoon,
    CommerceEmptyState,
    CommerceErrorState,
    CommerceLoadingRows,
} from '@/routes/commerce/-components/CommerceStates';
import { useOrderErrorText } from '@/routes/commerce/orders/-components/order-ui';
import { readOrderError } from '@/routes/commerce/orders/-shared/order-errors';
import { useCustomers } from '@/routes/commerce/customers/-shared/customer-hooks';
import {
    CUSTOMER_PAGE_SIZE,
    CUSTOMER_SEARCH_MAX,
    isCustomersApiMissing,
} from '@/routes/commerce/customers/-shared/customer-logic';
import type { CustomerRow } from '@/routes/commerce/customers/-shared/customer-types';

const SEARCH_DELAY_MS = 300;

export interface CustomersSearchState {
    q?: string;
    /** 1-based in the address. */
    page?: number;
}

/**
 * S7 Customers: the shop's buyers with their orders, spend, dues and COD
 * refusals. Read-only (no export, anonymise or edit in this phase). Without
 * the customers API on the server the screen says "coming soon".
 */
export function CustomersPage({
    search,
    onSearchChange,
}: {
    search: CustomersSearchState;
    onSearchChange: (next: CustomersSearchState) => void;
}) {
    const { t } = useTranslation('commerce');
    return (
        <CommercePage navId="commerce-customers" title={t('customers.title')} description={t('customers.description')}>
            <CustomersContent search={search} onSearchChange={onSearchChange} />
        </CommercePage>
    );
}

function CustomersContent({
    search,
    onSearchChange,
}: {
    search: CustomersSearchState;
    onSearchChange: (next: CustomersSearchState) => void;
}) {
    const { t } = useTranslation('commerce');
    const navigate = useNavigate();
    const access = useCommerceAccess();
    const errorText = useOrderErrorText();
    const enabled = access.isResolved && access.canOpen('commerce-customers');
    const q = search.q ?? '';
    const page = Math.max(0, (search.page ?? 1) - 1);

    const [typed, setTyped] = useState(q);
    const latest = useRef(q);
    useEffect(() => {
        if (q !== latest.current) {
            latest.current = q;
            setTyped(q);
        }
    }, [q]);
    useEffect(() => {
        const next = typed.trim();
        if (next === latest.current) return undefined;
        const timer = setTimeout(() => {
            latest.current = next;
            onSearchChange(next ? { q: next } : {});
        }, SEARCH_DELAY_MS);
        return () => clearTimeout(timer);
    }, [typed, onSearchChange]);

    const filters = useMemo(() => ({ search: q, page, pageSize: CUSTOMER_PAGE_SIZE }), [q, page]);
    const query = useCustomers(filters, enabled);
    const rows = useMemo(() => query.data?.customers ?? [], [query.data]);
    const total = query.data?.total ?? 0;
    const tableData = useMemo<TableData<CustomerRow>>(
        () => ({
            content: rows,
            total_pages: Math.max(1, Math.ceil(total / CUSTOMER_PAGE_SIZE)),
            page_no: page,
            page_size: CUSTOMER_PAGE_SIZE,
            total_elements: total,
            last: (page + 1) * CUSTOMER_PAGE_SIZE >= total,
        }),
        [rows, total, page]
    );

    const openCustomer = (row: CustomerRow) =>
        void navigate({ to: '/commerce/customers/$customerId', params: { customerId: row.id } });

    if (query.isError && isCustomersApiMissing(query.error)) {
        return <CommerceComingSoon title={t('customers.notAvailable')} />;
    }

    const name = (row: CustomerRow) => (
        <Link
            to="/commerce/customers/$customerId"
            params={{ customerId: row.id }}
            onClick={(event) => event.stopPropagation()}
            className="text-body font-medium text-primary-500 hover:underline"
        >
            {row.anonymised ? t('customers.anonymised') : row.name || t('customers.noName')}
        </Link>
    );
    const phone = (row: CustomerRow) =>
        row.phone ? (
            <a
                href={`tel:${row.phone}`}
                onClick={(event) => event.stopPropagation()}
                className="text-caption text-primary-500 hover:underline"
            >
                {row.phone}
            </a>
        ) : (
            <span className="text-caption text-muted-foreground">—</span>
        );
    const dues = (row: CustomerRow) => (
        <MoneyCell value={row.dues} dashOnZero className={cn(row.dues > 0 && 'text-warning-600')} />
    );
    const consent = (row: CustomerRow) => (
        <span className="text-caption text-foreground">
            {row.marketing_consent ? t('customers.yes') : t('customers.no')}
        </span>
    );
    const lastOrder = (row: CustomerRow) => (
        <span className="text-caption text-muted-foreground">
            {row.last_order_at ? formatDate(row.last_order_at) : '—'}
        </span>
    );

    const columns: ColumnDef<CustomerRow>[] = [
        { id: 'name', header: t('customers.columns.name'), size: 200, cell: ({ row }) => name(row.original) },
        { id: 'phone', header: t('customers.columns.phone'), size: 140, cell: ({ row }) => phone(row.original) },
        {
            id: 'email',
            header: t('customers.columns.email'),
            size: 200,
            cell: ({ row }) => <span className="text-caption text-foreground">{row.original.email ?? '—'}</span>,
        },
        {
            id: 'orders',
            header: t('customers.columns.orders'),
            size: 90,
            cell: ({ row }) => (
                <span className="block text-end text-body tabular-nums">{row.original.orders_count}</span>
            ),
        },
        {
            id: 'spent',
            header: t('customers.columns.totalSpent'),
            size: 130,
            cell: ({ row }) => <MoneyCell value={row.original.total_spent} />,
        },
        { id: 'dues', header: t('customers.columns.dues'), size: 120, cell: ({ row }) => dues(row.original) },
        { id: 'last', header: t('customers.columns.lastOrder'), size: 120, cell: ({ row }) => lastOrder(row.original) },
        {
            id: 'refusals',
            header: t('customers.columns.codRefusals'),
            size: 100,
            cell: ({ row }) => (
                <span className="block text-end text-body tabular-nums">{row.original.cod_refusals}</span>
            ),
        },
        { id: 'consent', header: t('customers.columns.consent'), size: 110, cell: ({ row }) => consent(row.original) },
    ];

    return (
        <div className="flex flex-col gap-4">
            <div className="relative rounded-lg border border-border bg-card p-3">
                <MagnifyingGlass
                    size={16}
                    className="pointer-events-none absolute start-6 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <MyInput
                    inputType="search"
                    input={typed}
                    maxLength={CUSTOMER_SEARCH_MAX}
                    onChangeFunction={(event) => setTyped(event.target.value)}
                    inputPlaceholder={t('customers.searchPlaceholder')}
                    aria-label={t('customers.searchPlaceholder')}
                    className="ps-9 sm:w-full"
                />
            </div>

            {query.isLoading && <CommerceLoadingRows rows={6} />}
            {query.isError && !query.data && (
                <CommerceErrorState
                    message={`${t('customers.loadFailed')} ${errorText(readOrderError(query.error))}`}
                    onRetry={() => void query.refetch()}
                />
            )}
            {query.isSuccess && rows.length === 0 && (
                <CommerceEmptyState
                    title={q ? t('customers.empty.filteredTitle') : t('customers.empty.title')}
                    description={q ? t('customers.empty.filteredDescription') : t('customers.empty.description')}
                >
                    {q && (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => {
                                setTyped('');
                                latest.current = '';
                                onSearchChange({});
                            }}
                        >
                            {t('customers.empty.clear')}
                        </MyButton>
                    )}
                </CommerceEmptyState>
            )}
            {query.data && rows.length > 0 && (
                <>
                    <ul className="flex flex-col gap-2 md:hidden">
                        {rows.map((row) => (
                            <li
                                key={row.id}
                                data-testid="customer-card"
                                className="flex cursor-pointer flex-col gap-2 rounded-lg border border-border bg-card p-3"
                                onClick={() => openCustomer(row)}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    {name(row)}
                                    {phone(row)}
                                </div>
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-muted-foreground">
                                    <span>{t('customers.ordersCount', { count: row.orders_count })}</span>
                                    <span className="flex items-center gap-1">
                                        {t('customers.columns.totalSpent')}
                                        <MoneyCell value={row.total_spent} />
                                    </span>
                                    {row.dues > 0 && (
                                        <span className="flex items-center gap-1">
                                            {t('customers.columns.dues')}
                                            {dues(row)}
                                        </span>
                                    )}
                                    {lastOrder(row)}
                                </div>
                            </li>
                        ))}
                    </ul>
                    <div className="hidden md:block">
                        <MyTable<CustomerRow>
                            data={tableData}
                            columns={columns}
                            isLoading={false}
                            error={null}
                            currentPage={page}
                            scrollable
                            onCellClick={(row) => openCustomer(row)}
                        />
                    </div>
                    <MyPagination
                        currentPage={page}
                        totalPages={tableData.total_pages}
                        totalElements={total}
                        pageSize={CUSTOMER_PAGE_SIZE}
                        onPageChange={(next) => onSearchChange({ ...(q ? { q } : {}), page: next + 1 })}
                        compactOnPhone
                    />
                </>
            )}
        </div>
    );
}
