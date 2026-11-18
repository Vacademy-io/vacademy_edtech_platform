import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { MoneyCell } from '@/components/design-system/money-cell';
import { formatDateTime } from '@/lib/formatters';
import { SectionCard } from '@/routes/commerce/-components/CatalogueBits';
import { CommerceLoadingRows, CommerceStatusChip } from '@/routes/commerce/-components/CommerceStates';
import { groupReview, needsRecount, type ReviewGroup } from '../-shared/count-sheet';
import { acceptCountLine } from '../-shared/inventory-api';
import { useCountReview, useInventoryAccess } from '../-shared/inventory-hooks';
import type { ReviewLine } from '../-shared/inventory-types';
import { formatQuantity } from '@/routes/commerce/orders/-shared/order-format';
import { InventoryErrorNotice, ItemCell, Qty, qtyUnit, TOUCH } from './inventory-ui';

/**
 * Review differences (contract §3.6, §7.3): per counted line the count, the
 * stock now, what was sold or moved since it was counted, what was expected
 * then and the difference (value for managers); then the groups of items and
 * pieces that need a look. Read only when asked: never while counting blind.
 *
 * A line whose stock moved while it was being counted (scans spread over
 * time) is flagged: count it again (type the shelf total) or, for a manager,
 * accept it as counted. Units packed in parcels are not on the shelf and are
 * shown, not counted.
 */
export function CountReviewPanel({
    countId,
    onClose,
    canAccept = false,
}: {
    countId: string;
    onClose: () => void;
    /** The server offers `ACCEPT` (a manager or admin at the place). */
    canAccept?: boolean;
}) {
    const { t } = useTranslation('commerce');
    const access = useInventoryAccess();
    const query = useCountReview(countId, true);
    const review = query.data;
    const [acceptError, setAcceptError] = useState<unknown>(null);
    const accept = async (line: ReviewLine) => {
        setAcceptError(null);
        try {
            await acceptCountLine(countId, line.line_id, line.counted_qty);
        } catch (e) {
            setAcceptError(e);
        }
        await query.refetch();
    };
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
                    {review.needs_recount > 0 && (
                        <p className="text-caption text-danger-600" data-testid="review-needs-recount">
                            {t('inventory.review.needsRecount', { count: review.needs_recount })}
                        </p>
                    )}
                    {review.measured_confirm && (
                        <p className="text-caption text-warning-600">{t('inventory.review.measuredConfirm')}</p>
                    )}
                    <InventoryErrorNotice error={acceptError} />
                    {groupReview(review).map((group) => (
                        <ReviewGroupBlock
                            key={group.id}
                            group={group}
                            showValue={access.isManager}
                            onAccept={canAccept ? accept : undefined}
                        />
                    ))}
                </>
            )}
        </SectionCard>
    );
}

function ReviewGroupBlock({
    group,
    showValue,
    onAccept,
}: {
    group: ReviewGroup;
    showValue: boolean;
    onAccept?: (line: ReviewLine) => Promise<void>;
}) {
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
                                        <ItemCell name={line.item_name} variant={line.variant_name} sku={line.sku} code={line.piece_code} />
                                        <LineFlags line={line} onAccept={onAccept} />
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
                            <ItemCell name={item.item_name} variant={item.variant_name} sku={item.sku} />
                            <Qty qty={item.on_hand_now} scale={item.qty_scale} unit={item.unit} className="text-caption" />
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

/** Under an item: changed while counted (with Accept for a manager), accepted, a large measured difference, parcels. */
function LineFlags({ line, onAccept }: { line: ReviewLine; onAccept?: (line: ReviewLine) => Promise<void> }) {
    const { t } = useTranslation('commerce');
    const flagged = needsRecount(line);
    return (
        <div className="flex flex-col items-start gap-1 text-caption">
            {flagged && (
                <span className="text-danger-600" data-testid={`review-flag-${line.line_id}`}>
                    {t('inventory.review.movedWhileCounting', {
                        qty: formatQty(line.moved_while_counting, line, t),
                    })}
                </span>
            )}
            {flagged && onAccept && (
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="small"
                    className="h-12 md:h-8"
                    onAsyncClick={() => onAccept(line)}
                    data-testid={`review-accept-${line.line_id}`}
                >
                    {t('inventory.review.accept')}
                </MyButton>
            )}
            {line.flags.includes('RECOUNT_ACCEPTED') && (
                <span className="text-muted-foreground">{t('inventory.review.accepted')}</span>
            )}
            {line.flags.includes('MEASURED_CONFIRM') && (
                <span className="text-warning-600">{t('inventory.review.measuredLine')}</span>
            )}
            {line.packed_unshipped > 0 && (
                <span className="text-muted-foreground">
                    {t('inventory.review.packed', { qty: formatQty(line.packed_unshipped, line, t) })}
                </span>
            )}
        </div>
    );
}

const formatQty = (qty: number, line: Pick<ReviewLine, 'qty_scale' | 'unit'>, t: TFunction) =>
    formatQuantity(Math.abs(qty), line.qty_scale, qtyUnit(line.unit), t);
