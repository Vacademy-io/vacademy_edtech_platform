import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { MyPagination } from '@/components/design-system/pagination';
import { formatDateTime } from '@/lib/formatters';
import { CommerceEmptyState, CommerceLoadingRows } from '@/routes/commerce/-components/CommerceStates';
import { createTransfer } from '../-shared/inventory-api';
import { useInvalidateInventory, useLowStock } from '../-shared/inventory-hooks';
import type { LowKind, LowRow } from '../-shared/inventory-types';
import type { TabProps } from './InventoryPage';
import { ChoiceGroup, InventoryErrorNotice, ItemCell, Qty } from './inventory-ui';
import { useInventoryWrite } from './use-inventory-write';

const PAGE_SIZE = 50;

/** The line a "Transfer from" sends: the shortage, never more than that place has. */
export const transferQuantity = (row: Pick<LowRow, 'shortage'>, available: number): number =>
    Math.max(1, Math.min(Math.max(row.shortage, 1), available));

/**
 * Low stock tab (contract §7.3), one place: at or below the reorder level, or
 * out of stock online; last sold here; where else it is. "Transfer from" a
 * place the person works at makes a draft transfer of the shortage and opens it.
 */
export function LowStockTab({ locationId, places }: TabProps) {
    const { t } = useTranslation('commerce');
    const navigate = useNavigate();
    const invalidate = useInvalidateInventory();
    const write = useInventoryWrite('low');
    const [kind, setKind] = useState<LowKind>('REORDER');
    const [page, setPage] = useState(0);
    const [error, setError] = useState<unknown>(null);
    const query = useLowStock({ locationId, kind, page, size: PAGE_SIZE });
    const rows = query.data?.rows ?? [];
    const total = query.data?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const mine = new Set(places.map((p) => p.id));

    const transferFrom = async (row: LowRow, from: { location_id: string; on_hand: number }) => {
        setError(null);
        const body = {
            from_location_id: from.location_id,
            to_location_id: locationId as string,
            lines: [{ package_session_id: row.package_session_id, quantity: transferQuantity(row, from.on_hand) }],
        };
        try {
            await write.run({
                scope: `low:${row.package_session_id}:${from.location_id}`,
                body,
                send: (id) => createTransfer({ ...body, client_request_id: id }),
                onDone: (view) => {
                    void invalidate();
                    void navigate({ to: '/commerce/inventory/transfers/$transferId', params: { transferId: view.id } });
                },
            });
        } catch (e) {
            setError(e);
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <ChoiceGroup<LowKind>
                name="low-kind"
                label={t('inventory.low.show')}
                value={kind}
                onChange={(value) => {
                    setKind(value);
                    setPage(0);
                }}
                options={[
                    { value: 'REORDER', label: t('inventory.low.reorder') },
                    { value: 'OUT_ONLINE', label: t('inventory.low.outOnline') },
                ]}
            />
            <InventoryErrorNotice error={error} />
            {query.isLoading && <CommerceLoadingRows rows={4} />}
            {query.isError && <InventoryErrorNotice error={query.error} />}
            {query.isSuccess && rows.length === 0 && <CommerceEmptyState title={t('inventory.low.empty')} />}
            {rows.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full min-w-max text-body">
                        <thead className="bg-neutral-50 text-caption text-muted-foreground">
                            <tr>
                                <th className="p-3 text-start font-medium">{t('inventory.columns.item')}</th>
                                <th className="p-3 text-end font-medium">{t('inventory.stock.onHand')}</th>
                                {kind === 'REORDER' ? (
                                    <>
                                        <th className="p-3 text-end font-medium">{t('inventory.stock.reorderLevel')}</th>
                                        <th className="p-3 text-end font-medium">{t('inventory.low.shortBy')}</th>
                                        <th className="p-3 text-start font-medium">{t('inventory.low.lastSale')}</th>
                                        <th className="p-3 text-start font-medium">{t('inventory.low.elsewhere')}</th>
                                    </>
                                ) : (
                                    <>
                                        <th className="p-3 text-end font-medium">{t('inventory.stock.heldOnline')}</th>
                                        <th className="p-3 text-end font-medium">{t('inventory.stock.sellableOnline')}</th>
                                    </>
                                )}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {rows.map((row) => (
                                <tr key={`${row.package_session_id}:${row.location_id ?? ''}`}>
                                    <td className="p-3">
                                        <ItemCell name={row.product_name} variant={row.variant_name} sku={row.sku} />
                                    </td>
                                    <td className="p-3 text-end">
                                        <Qty qty={kind === 'REORDER' ? row.on_hand : (row.online_on_hand ?? row.on_hand)} scale={row.qty_scale} unit={row.unit} />
                                    </td>
                                    {kind === 'REORDER' ? (
                                        <>
                                            <td className="p-3 text-end">
                                                <Qty qty={row.reorder_level} scale={row.qty_scale} unit={row.unit} />
                                            </td>
                                            <td className="p-3 text-end text-danger-600">
                                                <Qty qty={row.shortage} scale={row.qty_scale} unit={row.unit} />
                                            </td>
                                            <td className="p-3">{row.last_sale_at ? formatDateTime(row.last_sale_at) : t('inventory.low.never')}</td>
                                            <td className="p-3">
                                                <div className="flex flex-col gap-1">
                                                    {row.elsewhere.length === 0 && <span className="text-muted-foreground">—</span>}
                                                    {row.elsewhere.map((other) => (
                                                        <div key={other.location_id} className="flex flex-wrap items-center gap-2">
                                                            <span className="text-caption">
                                                                {other.location_name ?? other.location_id}:{' '}
                                                                <Qty qty={other.on_hand} scale={row.qty_scale} unit={row.unit} />
                                                            </span>
                                                            {mine.has(other.location_id) && (
                                                                <MyButton
                                                                    type="button"
                                                                    buttonType="secondary"
                                                                    scale="small"
                                                                    className="h-12 md:h-8"
                                                                    onAsyncClick={() => transferFrom(row, other)}
                                                                >
                                                                    {t('inventory.low.transferFrom', { place: other.location_name ?? '' })}
                                                                </MyButton>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </td>
                                        </>
                                    ) : (
                                        <>
                                            <td className="p-3 text-end">
                                                <Qty qty={row.held_online} scale={row.qty_scale} unit={row.unit} />
                                            </td>
                                            <td className="p-3 text-end text-danger-600">
                                                <Qty qty={row.sellable_online} scale={row.qty_scale} unit={row.unit} />
                                            </td>
                                        </>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {total > PAGE_SIZE && (
                <MyPagination
                    currentPage={page}
                    totalPages={totalPages}
                    totalElements={total}
                    pageSize={PAGE_SIZE}
                    onPageChange={setPage}
                    compactOnPhone
                />
            )}
            {write.dialog}
        </div>
    );
}
