import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyPagination } from '@/components/design-system/pagination';
import { MyTable } from '@/components/design-system/table';
import { PlainSelect, useAdminLanguage } from '@/routes/commerce/-components/CatalogueBits';
import { CommerceEmptyState, CommerceLoadingRows } from '@/routes/commerce/-components/CommerceStates';
import { useCollections } from '@/routes/commerce/-shared/commerce-hooks';
import { useInventoryAccess, useOverview } from '../-shared/inventory-hooks';
import type { OverviewFilter, OverviewRow, PlaceRef } from '../-shared/inventory-types';
import { AdjustDialog } from './AdjustDialog';
import { useDebounced } from './ItemPicker';
import type { TabProps } from './InventoryPage';
import { collectionName, InventoryErrorNotice, ItemCell, Qty } from './inventory-ui';
import { ReorderLevelDialog } from './ReorderLevelDialog';

const PAGE_SIZE = 50;
export const MAX_OVERVIEW_PLACES = 8;
const FILTERS: OverviewFilter[] = ['ALL', 'LOW', 'OUT'];

/** The columns of the Stock tab: one place, or the first eight of mine by code. */
export function overviewPlaces(locationId: string | null, places: TabProps['places']): { ids: string[]; cut: boolean } {
    if (locationId) return { ids: [locationId], cut: false };
    const active = places.filter((p) => p.status !== 'INACTIVE').sort((a, b) => a.code.localeCompare(b.code));
    return { ids: active.slice(0, MAX_OVERVIEW_PLACES).map((p) => p.id), cut: active.length > MAX_OVERVIEW_PLACES };
}

/** Stock tab (contract §7.3): on hand per place, on the way, held and sellable online. Never cost. */
export function StockTab({ locationId, places }: TabProps) {
    const { t } = useTranslation('commerce');
    const navigate = useNavigate();
    const access = useInventoryAccess();
    const lang = useAdminLanguage();
    const [text, setText] = useState('');
    const q = useDebounced(text.trim());
    const [filter, setFilter] = useState<OverviewFilter>('ALL');
    const [collectionId, setCollectionId] = useState('');
    const [page, setPage] = useState(0);
    const [adjusting, setAdjusting] = useState<{ row: OverviewRow; place: PlaceRef } | null>(null);
    const [reorder, setReorder] = useState<{ row: OverviewRow; place: PlaceRef } | null>(null);

    const { ids, cut } = overviewPlaces(locationId, places);
    const query = useOverview({ locationIds: ids, q, filter, collectionId, page, size: PAGE_SIZE });
    // Collections are read by managers only (the catalogue routes are manager-only).
    const collections = useCollections(0, 100, access.enabled && access.isManager);
    const columnsPlaces: PlaceRef[] = query.data?.locations.length
        ? query.data.locations
        : ids.map((id) => {
              const p = places.find((place) => place.id === id);
              return { id, code: p?.code ?? null, name: p?.name ?? null, gstin: null };
          });
    const single = columnsPlaces.length === 1 ? columnsPlaces[0] : null;

    const openMovements = (row: OverviewRow, placeId: string) =>
        void navigate({
            to: '/commerce/inventory',
            search: { tab: 'movements', item: row.package_session_id, location: placeId },
        });

    const columns = useMemo<ColumnDef<OverviewRow>[]>(() => {
        const levelOf = (row: OverviewRow, id: string) => row.levels.find((l) => l.location_id === id);
        const placeColumns: ColumnDef<OverviewRow>[] = columnsPlaces.map((place) => ({
            id: `place-${place.id}`,
            header: columnsPlaces.length === 1 ? t('inventory.stock.onHand') : (place.code ?? place.name ?? ''),
            cell: ({ row }) => {
                const level = levelOf(row.original, place.id);
                return (
                    <button
                        type="button"
                        onClick={() => openMovements(row.original, place.id)}
                        aria-label={t('inventory.stock.openMovements')}
                        className="flex min-h-12 w-full items-center justify-end gap-2 hover:underline md:min-h-0"
                    >
                        <Qty
                            qty={level?.on_hand ?? 0}
                            scale={row.original.qty_scale}
                            unit={row.original.unit}
                            className={level?.low ? 'text-danger-600' : undefined}
                        />
                        {level?.low && (
                            <span className="rounded-sm bg-danger-50 px-1 text-caption text-danger-600">
                                {t('inventory.stock.lowChip')}
                            </span>
                        )}
                    </button>
                );
            },
        }));
        const number = (value: number | null, row: OverviewRow) => (
            <span className="block text-end">
                <Qty qty={value} scale={row.qty_scale} unit={row.unit} />
            </span>
        );
        return [
            {
                id: 'item',
                header: t('inventory.columns.item'),
                cell: ({ row }) => (
                    <ItemCell name={row.original.product_name} variant={row.original.variant_name} sku={row.original.sku} />
                ),
            },
            ...placeColumns,
            { id: 'transit', header: t('inventory.stock.inTransit'), cell: ({ row }) => number(row.original.in_transit, row.original) },
            { id: 'held', header: t('inventory.stock.heldOnline'), cell: ({ row }) => number(row.original.held_online, row.original) },
            {
                id: 'sellable',
                header: t('inventory.stock.sellableOnline'),
                cell: ({ row }) => number(row.original.sellable_online, row.original),
            },
            ...(single
                ? [
                      {
                          id: 'reorder',
                          header: t('inventory.stock.reorderLevel'),
                          cell: ({ row }: { row: { original: OverviewRow } }) =>
                              number(levelOf(row.original, single.id)?.reorder_level ?? null, row.original),
                      } as ColumnDef<OverviewRow>,
                  ]
                : []),
            {
                id: 'actions',
                header: '',
                cell: ({ row }) => (
                    <div className="flex justify-end gap-1">
                        {single && (
                            <MyButton
                                type="button"
                                buttonType="text"
                                scale="small"
                                className="h-12 md:h-6"
                                onClick={() => setAdjusting({ row: row.original, place: single })}
                            >
                                {t('inventory.stock.adjust')}
                            </MyButton>
                        )}
                        {single && access.isManager && (
                            <MyButton
                                type="button"
                                buttonType="text"
                                scale="small"
                                className="h-12 md:h-6"
                                onClick={() => setReorder({ row: row.original, place: single })}
                            >
                                {t('inventory.stock.setReorder')}
                            </MyButton>
                        )}
                    </div>
                ),
            },
        ];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [t, columnsPlaces.map((p) => p.id).join(','), single?.id, access.isManager]);

    const total = query.data?.total ?? 0;
    const rows = query.data?.rows ?? [];
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    return (
        <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="flex min-w-0 flex-col gap-1.5 text-caption text-muted-foreground">
                    {t('inventory.stock.search')}
                    <span className="relative">
                        <MagnifyingGlass
                            size={16}
                            className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-neutral-400"
                        />
                        <input
                            value={text}
                            onChange={(event) => {
                                setText(event.target.value);
                                setPage(0);
                            }}
                            placeholder={t('inventory.picker.placeholder')}
                            maxLength={64}
                            className="h-12 w-full rounded-md border border-neutral-300 bg-background pe-3 ps-9 text-body text-foreground focus:border-primary-500 focus:outline-none md:h-9"
                        />
                    </span>
                </label>
                <PlainSelect
                    label={t('inventory.stock.show')}
                    value={filter}
                    onChange={(value) => {
                        setFilter((value || 'ALL') as OverviewFilter);
                        setPage(0);
                    }}
                    options={FILTERS.map((f) => ({ value: f, label: t(`inventory.stock.filter.${f}`) }))}
                />
                {access.isManager && (
                    <PlainSelect
                        label={t('inventory.stock.collection')}
                        value={collectionId}
                        noneLabel={t('inventory.stock.allCollections')}
                        onChange={(value) => {
                            setCollectionId(value);
                            setPage(0);
                        }}
                        options={(collections.data?.content ?? []).map((c) => ({ value: c.id, label: collectionName(c, lang) }))}
                    />
                )}
            </div>
            {cut && <p className="text-caption text-muted-foreground">{t('inventory.stock.firstEight', { count: MAX_OVERVIEW_PLACES })}</p>}
            {query.isLoading && <CommerceLoadingRows rows={5} />}
            {query.isError && <InventoryErrorNotice error={query.error} />}
            {query.isSuccess && rows.length === 0 && <CommerceEmptyState title={t('inventory.stock.empty')} />}
            {rows.length > 0 && (
                <>
                    <MyTable<OverviewRow>
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
            {adjusting && (
                <AdjustDialog
                    open
                    onOpenChange={(open) => !open && setAdjusting(null)}
                    item={adjusting.row}
                    place={adjusting.place}
                />
            )}
            {reorder && (
                <ReorderLevelDialog
                    open
                    onOpenChange={(open) => !open && setReorder(null)}
                    item={reorder.row}
                    place={reorder.place}
                    current={reorder.row.levels.find((l) => l.location_id === reorder.place.id)?.reorder_level ?? null}
                />
            )}
        </div>
    );
}
