import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { CommerceLoadingRows } from '@/routes/commerce/-components/CommerceStates';
import { DialogButtons } from '@/routes/commerce/orders/-components/order-ui';
import { canPost } from '../-shared/count-sheet';
import { postCount } from '../-shared/inventory-api';
import { useCountReview, useInvalidateInventory } from '../-shared/inventory-hooks';
import { type CountView, UNCOUNTED_CHOICES, type UncountedChoice } from '../-shared/inventory-types';
import { ChoiceGroup, InventoryErrorNotice, TOUCH } from './inventory-ui';
import { useInventoryWrite } from './use-inventory-write';

/**
 * Post count (contract §3.6): what happens to items nobody counted is a
 * required choice with no default (leave as is / set to zero); the totals of
 * the review; a difference above the shop's limit asks for a manager's PIN
 * (approvers of the count's place) and the same body goes again with
 * `approval`, under the same request id.
 */
export function PostCountDialog({
    open,
    onOpenChange,
    view,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    view: CountView;
}) {
    const { t } = useTranslation('commerce');
    const invalidate = useInvalidateInventory();
    const write = useInventoryWrite('cnt');
    const review = useCountReview(view.id, open);
    const [choice, setChoice] = useState<UncountedChoice | null>(null);
    const [error, setError] = useState<unknown>(null);

    const post = async () => {
        setError(null);
        if (!canPost(choice)) return;
        const body = { uncounted: choice };
        try {
            await write.run({
                scope: `post:${view.id}`,
                body,
                approvalAt: view.location?.id ?? null,
                approvalText: t('inventory.approval.count'),
                send: (id, approval) => postCount(view.id, { ...body, client_request_id: id, ...(approval ? { approval } : {}) }),
                onDone: () => {
                    toast.success(t('inventory.counts.postedDone'));
                    void invalidate();
                    onOpenChange(false);
                },
            });
        } catch (e) {
            setError(e);
        }
    };

    const totals = review.data?.totals;
    return (
        <>
            <MyDialog
                heading={t('inventory.counts.post')}
                open={open && !write.pinOpen}
                onOpenChange={onOpenChange}
                dialogWidth="max-w-lg"
                footer={
                    <DialogButtons onCancel={() => onOpenChange(false)}>
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            className={TOUCH}
                            disable={canPost(choice) ? undefined : true}
                            onAsyncClick={post}
                            data-testid="count-post"
                        >
                            {t('inventory.counts.post')}
                        </MyButton>
                    </DialogButtons>
                }
            >
                <div className="flex flex-col gap-4">
                    {review.isLoading && <CommerceLoadingRows rows={1} />}
                    {totals && (
                        <p className="text-body">
                            {t('inventory.review.totals', {
                                lines: totals.lines_with_difference,
                                up: totals.units_up,
                                down: totals.units_down,
                            })}
                        </p>
                    )}
                    {review.data && review.data.uncounted.length > 0 && (
                        <p className="text-caption text-warning-600">
                            {t('inventory.counts.uncountedCount', { count: review.data.uncounted.length })}
                        </p>
                    )}
                    <ChoiceGroup<UncountedChoice>
                        name="uncounted"
                        label={t('inventory.counts.uncounted')}
                        value={choice}
                        onChange={setChoice}
                        columns={1}
                        options={UNCOUNTED_CHOICES.map((value) => ({ value, label: t(`inventory.counts.uncounted${value}`) }))}
                    />
                    <InventoryErrorNotice error={error} />
                </div>
            </MyDialog>
            {write.dialog}
        </>
    );
}
