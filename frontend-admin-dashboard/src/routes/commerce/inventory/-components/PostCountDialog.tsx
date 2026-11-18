import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { CommerceLoadingRows } from '@/routes/commerce/-components/CommerceStates';
import { DialogButtons } from '@/routes/commerce/orders/-components/order-ui';
import { canPost } from '../-shared/count-sheet';
import { readInventoryError } from '../-shared/inventory-errors';
import { postCount } from '../-shared/inventory-api';
import { useCountReview, useInvalidateInventory, useInventoryAccess } from '../-shared/inventory-hooks';
import { type CountView, UNCOUNTED_CHOICES, type UncountedChoice } from '../-shared/inventory-types';
import { ChoiceGroup, InventoryErrorNotice, TOUCH } from './inventory-ui';
import { useInventoryWrite } from './use-inventory-write';

/**
 * Post count (contract §3.6): what happens to items nobody counted is a
 * required choice with no default (leave as is / set to zero); the totals of
 * the review; a difference above the shop's limit asks for a manager's PIN
 * (approvers of the count's place) and the same body goes again with
 * `approval`, under the same request id. Lines that changed while they were
 * counted block Post until counted again or accepted. A large difference on a
 * measured item needs a manager's explicit yes (`confirm_measured`; staff get
 * the PIN dialog, and the PIN is that yes). Every post (the PIN resend too)
 * carries the `fingerprint` of the review shown here: when lines were saved
 * since, the server refuses with `COUNT_CHANGED`; the review is read again and
 * the person checks it before posting again (never re-posted on its own).
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
    const access = useInventoryAccess();
    const review = useCountReview(view.id, open);
    const [choice, setChoice] = useState<UncountedChoice | null>(null);
    const [measuredOk, setMeasuredOk] = useState(false);
    const [changed, setChanged] = useState(false);
    const blockedByRecount = (review.data?.needs_recount ?? 0) > 0;
    const askMeasured = !!review.data?.measured_confirm && access.isManager;
    const ready = !!review.data && canPost(choice) && !blockedByRecount && (!askMeasured || measuredOk);
    const [error, setError] = useState<unknown>(null);

    const post = async () => {
        setError(null);
        setChanged(false);
        if (!canPost(choice) || !ready) return;
        // The fingerprint is part of the body the request id follows (and of the server's hash): a PIN resend
        // carries the same one; after a new review the body differs, so a new id goes.
        // `confirm_measured` stays out of it (the server leaves it out of its hash).
        const fingerprint = review.data?.fingerprint;
        const body = { uncounted: choice, ...(fingerprint ? { review_fingerprint: fingerprint } : {}) };
        const confirm = askMeasured && measuredOk ? { confirm_measured: true } : {};
        try {
            await write.run({
                scope: `post:${view.id}`,
                body,
                approvalAt: view.location?.id ?? null,
                approvalText: t('inventory.approval.count'),
                send: async (id, approval) => {
                    try {
                        return await postCount(view.id, {
                            ...body,
                            ...confirm,
                            client_request_id: id,
                            ...(approval ? { approval } : {}),
                        });
                    } catch (e) {
                        // Lines were saved after this review (also when the PIN resend meets it): read it again.
                        if (readInventoryError(e).code === 'COUNT_CHANGED') {
                            setChanged(true);
                            void review.refetch();
                        }
                        throw e;
                    }
                },
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
                            disable={ready ? undefined : true}
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
                    {changed && (
                        <p role="alert" className="text-caption text-danger-600" data-testid="post-count-changed">
                            {t('inventory.counts.changedSinceReview')}
                        </p>
                    )}
                    {blockedByRecount && (
                        <p role="alert" className="text-caption text-danger-600" data-testid="post-needs-recount">
                            {t('inventory.review.needsRecount', { count: review.data?.needs_recount ?? 0 })}
                        </p>
                    )}
                    {askMeasured && (
                        <label className="flex min-h-12 cursor-pointer items-center gap-3 text-body">
                            <input
                                type="checkbox"
                                checked={measuredOk}
                                onChange={(event) => setMeasuredOk(event.target.checked)}
                                className="size-5 shrink-0 accent-primary-500"
                                data-testid="post-confirm-measured"
                            />
                            {t('inventory.counts.confirmMeasured')}
                        </label>
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
