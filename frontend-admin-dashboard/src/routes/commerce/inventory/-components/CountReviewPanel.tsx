import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { MoneyCell } from '@/components/design-system/money-cell';
import { formatDateTime } from '@/lib/formatters';
import { SectionCard } from '@/routes/commerce/-components/CatalogueBits';
import { CommerceLoadingRows, CommerceStatusChip } from '@/routes/commerce/-components/CommerceStates';
import { groupReview, type ReviewGroup } from '../-shared/count-sheet';
import { useCountReview, useInventoryAccess } from '../-shared/inventory-hooks';
import { InventoryErrorNotice, ItemCell, Qty, TOUCH } from './inventory-ui';

/**
 * Review differences (contract §3.6, §7.3): per counted line the count, the
 * stock now, what was sold or moved since it was counted, what was expected
 * then and the difference (value for managers); then the groups of items and
 * pieces that need a look. Read only when asked: never while counting blind.
 */
export function CountReviewPanel({ countId, onClose }: { countId: string; onClose: () => void }) {
    const { t } = useTranslation('commerce');
    const access = useInventoryAccess();
    const query = useCountReview(countId, true);
    const review = query.data;
    return (
        <SectionCard
            title={t('inventory.counts.review')}
            description={review?.as_of ? t('inventory.review.asOf', { time: formatDateTime(review.as_of) }) : undefined}
            actions={
                <div className="flex gap-2">
                    <MyButton type="button" buttonType="secondary" scale="medium" className={TOUCH} onAsyncClick={async () => void (await query.refetch())}>
                        {t('inventory.review.refresh')}
                    </MyButton>
                    <MyButton type="button" buttonType="text" scale="medium" className={TOUCH} onClick={onClose}>
                        {t('inventory.review.close')}
                    </MyButton>
                </div>
            }
        >
            {query.isLoading && <CommerceLoadingRows rows={3} />}
            {query.isError && <InventoryErrorNotice error={query.error} />}
            {review && (
                <>
                    <p className="text-body" data-testid="review-totals">
                        {t('inventory.review.totals', {
                            lines: review.totals.lines_with_difference,
                            up: review.totals.units_up,
                            down: review.totals.units_down,
                        })}
                    </p>
                    {review.needs_approval && <p className="text-caption text-warning-600">{t('inventory.review.needsApproval')}</p>}
                    {groupReview(review).map((group) => (
                        <ReviewGroupBlock key={group.id} group={group} showValue={access.isManager} />
                    ))}
                </>
            )}
        </SectionCard>
    );
}

function ReviewGroupBlock({ group, showValue }: { group: ReviewGroup; showValue: boolean }) {
    const { t } = useTranslation('commerce');
    const title = t(`inventory.review.groups.${group.id}`);
    if ('lines' in group) {
        return (
            <div className="flex flex-col gap-2">
                <h4 className="text-subtitle font-medium">{title}</h4>
                <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full min-w-max text-body">
                        <thead className="bg-neutral-50 text-caption text-muted-foreground">
                            <tr>
                                <th className="p-2 text-start font-medium">{t('inventory.columns.item')}</th>
                                <th className="p-2 text-end font-medium">{t('inventory.review.counted')}</th>
                                <th className="p-2 text-end font-medium">{t('inventory.review.now')}</th>
                                <th className="p-2 text-end font-medium">{t('inventory.review.movedSince')}</th>
                                <th className="p-2 text-end font-medium">{t('inventory.review.expected')}</th>
                                <th className="p-2 text-end font-medium">{t('inventory.review.difference')}</th>
                                {showValue && <th className="p-2 text-end font-medium">{t('inventory.review.value')}</th>}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {group.lines.map((line) => (
                                <tr key={line.line_id}>
                                    <td className="p-2">
                                        <ItemCell name={line.item_name} sku={line.sku} code={line.piece_code} />
                                    </td>
                                    <td className="p-2 text-end"><Qty qty={line.counted_qty} scale={line.qty_scale} unit={line.unit} /></td>
                                    <td className="p-2 text-end"><Qty qty={line.on_hand_now} scale={line.qty_scale} unit={line.unit} /></td>
                                    <td className="p-2 text-end"><Qty qty={line.moved_since} scale={line.qty_scale} unit={line.unit} /></td>
                                    <td className="p-2 text-end"><Qty qty={line.expected_at_count} scale={line.qty_scale} unit={line.unit} /></td>
                                    <td className={line.adjustment < 0 ? 'p-2 text-end text-danger-600' : 'p-2 text-end'}>
                                        {line.adjustment > 0 ? '+' : line.adjustment < 0 ? '−' : ''}
                                        <Qty qty={Math.abs(line.adjustment)} scale={line.qty_scale} unit={line.unit} />
                                    </td>
                                    {showValue && (
                                        <td className="p-2 text-end">{line.value === null ? '—' : <MoneyCell value={line.value} />}</td>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }
    if ('items' in group) {
        return (
            <div className="flex flex-col gap-2">
                <h4 className="text-subtitle font-medium">{title}</h4>
                <p className="text-caption text-muted-foreground">{t('inventory.review.uncountedHelp')}</p>
                <ul className="flex flex-col divide-y divide-border">
                    {group.items.map((item) => (
                        <li key={item.package_session_id} className="flex items-center justify-between py-2">
                            <ItemCell name={item.item_name} sku={item.sku} />
                            <span className="text-caption tabular-nums">{item.on_hand_now}</span>
                        </li>
                    ))}
                </ul>
            </div>
        );
    }
    return (
        <div className="flex flex-col gap-2">
            <h4 className="text-subtitle font-medium">{title}</h4>
            <ul className="flex flex-col divide-y divide-border">
                {group.pieces.map((piece) => (
                    <li key={piece.piece_id} className="flex items-center justify-between gap-2 py-2">
                        <ItemCell name={piece.item_name} sku={piece.sku} code={piece.code} />
                        <span className="flex items-center gap-2 text-caption">
                            {piece.location_name}
                            <CommerceStatusChip kind="piece" value={piece.status} />
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
