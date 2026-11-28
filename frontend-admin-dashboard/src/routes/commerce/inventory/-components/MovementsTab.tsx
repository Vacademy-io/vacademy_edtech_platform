import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { DownloadSimple } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyPagination } from '@/components/design-system/pagination';
import { MyTable } from '@/components/design-system/table';
import { formatDateTime } from '@/lib/formatters';
import { PlainSelect, useAdminLanguage } from '@/routes/commerce/-components/CatalogueBits';
import { CommerceEmptyState, CommerceLoadingRows, CommerceStatusChip } from '@/routes/commerce/-components/CommerceStates';
import { formatCost } from '@/routes/commerce/-shared/units';
import { inputClass } from '@/routes/commerce/orders/-components/order-ui';
import { exportMovements } from '../-shared/inventory-api';
import { useInventoryAccess, useMovements } from '../-shared/inventory-hooks';
import { MOVEMENT_REASONS, MOVEMENT_TYPES, type MovementRow } from '../-shared/inventory-types';
import { downloadBlob } from '../-shared/label-print';
import { ItemPicker, pickName } from './ItemPicker';
import type { TabProps } from './InventoryPage';
import { InventoryErrorNotice, ItemCell, Qty, TOUCH } from './inventory-ui';

const PAGE_SIZE = 50;
const KNOWN_REASONS = new Set<string>(MOVEMENT_REASONS);

/** Where a ledger row came from, as a link to its screen (receipt, transfer, count, order). */
export function referenceLink(row: Pick<MovementRow, 'reference' | 'reference_type' | 'reference_id' | 'transfer_id'>):
    | { to: string; params: Record<string, string>; label: string | null }
    | null {
    const type = (row.reference?.type ?? row.reference_type ?? '').toUpperCase();
    const id = row.reference?.id ?? row.reference_id;
    const label = row.reference?.label ?? null;
    if (row.reference?.order_id) {
        return { to: '/commerce/orders/$orderId', params: { orderId: row.reference.order_id }, label };
    }
    if (!id) return null;
    if (type === 'STOCK_RECEIPT') return { to: '/commerce/inventory/receipts/$receiptId', params: { receiptId: id }, label };
    if (type === 'STOCK_TRANSFER' || row.transfer_id) {
        return { to: '/commerce/inventory/transfers/$transferId', params: { transferId: row.transfer_id ?? id }, label };
    }
    if (type === 'STOCK_COUNT') return { to: '/commerce/inventory/counts/$countId', params: { countId: id }, label };
    if (type.includes('ORDER')) return { to: '/commerce/orders/$orderId', params: { orderId: id }, label };
    return null;
}

/** Movements tab (contract §7.3): the stock ledger with filters and a CSV export. */
export function MovementsTab({
    locationId,
    allPlaces,
    item,
    onItem,
}: TabProps & { item: string | undefined; onItem: (item: string | undefined) => void }) {
    const { t } = useTranslation('commerce');
    const lang = useAdminLanguage();
    const access = useInventoryAccess();
    const [type, setType] = useState('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [page, setPage] = useState(0);
    const [itemLabel, setItemLabel] = useState<string | null>(null);
    const [exportProblem, setExportProblem] = useState<string | null>(null);
    const [exportError, setExportError] = useState<unknown>(null);

    const filters = {
        locationId: locationId ?? undefined,
        packageSessionId: item,
        type: type || undefined,
        from: from || undefined,
        to: to || undefined,
        page,
        size: PAGE_SIZE,
    };
    const query = useMovements(filters);
    const rows = query.data?.rows ?? [];
    const total = query.data?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const placeCode = (id: string | null) => allPlaces.find((p) => p.id === id)?.code ?? '—';

    const columns = useMemo<ColumnDef<MovementRow>[]>(
        () => [
            {
                id: 'time',
                header: t('inventory.movements.time'),
                cell: ({ row }) => (row.original.created_at ? formatDateTime(row.original.created_at) : '—'),
            },
            { id: 'place', header: t('inventory.movements.place'), cell: ({ row }) => placeCode(row.original.location_id) },
            {
                id: 'item',
                header: t('inventory.columns.item'),
                cell: ({ row }) => (
                    <ItemCell
                        name={row.original.product_name}
                        variant={row.original.variant_name}
                        sku={row.original.sku}
                        code={row.original.piece_code}
                    />
                ),
            },
            {
                id: 'type',
                header: t('inventory.movements.type'),
                cell: ({ row }) => <CommerceStatusChip kind="movementType" value={row.original.type} />,
            },
            {
                id: 'qty',
                header: t('inventory.movements.quantity'),
                cell: ({ row }) => {
                    const delta = row.original.quantity_delta;
                    return (
                        <span className="block text-end">
                            {delta > 0 ? '+' : delta < 0 ? '−' : ''}
                            <Qty qty={Math.abs(delta)} scale={row.original.qty_scale} unit={row.original.unit} />
                        </span>
                    );
                },
            },
            {
                id: 'balance',
                header: t('inventory.movements.balance'),
                cell: ({ row }) => (
                    <span className="block text-end">
                        <Qty qty={row.original.balance_after} scale={row.original.qty_scale} unit={row.original.unit} />
                    </span>
                ),
            },
            {
                id: 'reference',
                header: t('inventory.movements.reference'),
                cell: ({ row }) => {
                    const link = referenceLink(row.original);
                    const text = link?.label ?? row.original.reference?.label ?? row.original.reference_type ?? '—';
                    if (!link) return <span className="text-caption text-muted-foreground">{text}</span>;
                    return (
                        <Link to={link.to as never} params={link.params as never} className="text-primary-500 hover:underline">
                            {link.label ?? t('inventory.movements.open')}
                        </Link>
                    );
                },
            },
            {
                id: 'reason',
                header: t('inventory.movements.reason'),
                cell: ({ row }) => {
                    const reason = row.original.reason;
                    if (!reason) return '—';
                    return KNOWN_REASONS.has(reason) ? t(`inventory.reasons.${reason}`) : reason;
                },
            },
            {
                id: 'note',
                header: t('inventory.movements.note'),
                cell: ({ row }) => <span className="line-clamp-2 text-caption">{row.original.note ?? ''}</span>,
            },
            ...(access.isManager
                ? [
                      {
                          id: 'cost',
                          header: t('inventory.movements.unitCost'),
                          cell: ({ row }: { row: { original: MovementRow } }) =>
                              row.original.unit_cost === null ? (
                                  '—'
                              ) : (
                                  <span className="tabular-nums">
                                      {formatCost(row.original.unit_cost, row.original.qty_scale, row.original.unit, t)}
                                  </span>
                              ),
                      } as ColumnDef<MovementRow>,
                  ]
                : []),
        ],
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [t, access.isManager, allPlaces]
    );

    const doExport = async () => {
        setExportProblem(null);
        setExportError(null);
        if (!from || !to) return setExportProblem(t('inventory.movements.exportNeedsDates'));
        try {
            const blob = await exportMovements({ locationId: filters.locationId, packageSessionId: item, type: filters.type, from, to });
            downloadBlob(blob, `stock-movements-${from}-${to}.csv`);
        } catch (e) {
            setExportError(e);
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <PlainSelect
                    label={t('inventory.movements.type')}
                    value={type}
                    noneLabel={t('inventory.movements.allTypes')}
                    onChange={(value) => {
                        setType(value);
                        setPage(0);
                    }}
                    options={MOVEMENT_TYPES.map((value) => ({ value, label: t(`status.movementType.${value}`) }))}
                />
                <label className="flex flex-col gap-1.5 text-caption text-muted-foreground">
                    {t('inventory.movements.from')}
                    <input
                        type="date"
                        className={inputClass}
                        value={from}
                        onChange={(event) => {
                            setFrom(event.target.value);
                            setPage(0);
                        }}
                    />
                </label>
                <label className="flex flex-col gap-1.5 text-caption text-muted-foreground">
                    {t('inventory.movements.to')}
                    <input
                        type="date"
                        className={inputClass}
                        value={to}
                        onChange={(event) => {
                            setTo(event.target.value);
                            setPage(0);
                        }}
                    />
                </label>
                <ItemPicker
                    label={t('inventory.columns.item')}
                    locationId={locationId}
                    selected={item ? (itemLabel ?? rows[0]?.sku ?? t('inventory.movements.oneItem')) : null}
                    onClear={() => {
                        setItemLabel(null);
                        onItem(undefined);
                        setPage(0);
                    }}
                    onPick={(picked) => {
                        setItemLabel(`${pickName(picked, lang)}${picked.sku ? ` · ${picked.sku}` : ''}`);
                        onItem(picked.package_session_id);
                        setPage(0);
                    }}
                />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-caption text-muted-foreground">{t('inventory.movements.exportHint')}</p>
                <MyButton type="button" buttonType="secondary" scale="medium" className={TOUCH} onAsyncClick={doExport}>
                    <DownloadSimple size={16} />
                    {t('inventory.movements.export')}
                </MyButton>
            </div>
            {exportProblem && (
                <p role="alert" className="text-caption text-danger-600">
                    {exportProblem}
                </p>
            )}
            <InventoryErrorNotice error={exportError} />
            {query.isLoading && <CommerceLoadingRows rows={5} />}
            {query.isError && <InventoryErrorNotice error={query.error} />}
            {query.isSuccess && rows.length === 0 && <CommerceEmptyState title={t('inventory.movements.empty')} />}
            {rows.length > 0 && (
                <>
                    <MyTable<MovementRow>
                        fillContainer
                        enableColumnResizing={false}
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
        </div>
    );
}
