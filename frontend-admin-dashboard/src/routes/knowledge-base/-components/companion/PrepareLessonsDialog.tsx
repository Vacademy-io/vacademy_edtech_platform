import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Coins, Lightning, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNumber } from '@/lib/formatters';
import { usePrepareLessons } from '../../-hooks/companion';
import { companionErrorMessage, isCreditsExhausted } from '../../-services/companion-service';
import type { PrepareResult } from '../../-types/companion';

/**
 * Prepare lessons in advance: a dry run first (count + credit estimate +
 * balance), then the real call. Without this, the first student to open a
 * topic waits a minute or two while its lesson is prepared.
 */
export function PrepareLessonsDialog({
    companionId,
    open,
    onOpenChange,
}: {
    companionId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { t } = useTranslation('knowledgeBaseCompanions');
    const prepare = usePrepareLessons(companionId);
    const [estimate, setEstimate] = useState<PrepareResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setEstimate(null);
        setError(null);
        prepare
            .mutateAsync({ dry_run: true })
            .then(setEstimate)
            .catch((e) => setError(companionErrorMessage(e) ?? t('prepare.estimateFailed')));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, companionId]);

    const count = estimate?.this_call ?? 0;
    const more = estimate ? estimate.to_prepare > estimate.this_call : false;
    const short = estimate?.balance != null && estimate.balance < (estimate.estimated_credits ?? 0);

    const start = async () => {
        try {
            const res = await prepare.mutateAsync({ dry_run: false });
            toast.success(t('prepare.started', { count: res.started || res.this_call }));
            onOpenChange(false);
        } catch (e) {
            toast.error(
                isCreditsExhausted(e)
                    ? companionErrorMessage(e) ?? t('prepare.noCredits')
                    : companionErrorMessage(e) ?? t('prepare.startFailed')
            );
        }
    };

    return (
        <MyDialog
            heading={t('prepare.heading')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-lg"
            footer={
                <div className="flex w-full justify-end gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        {count > 0 ? t('actions.cancel') : t('actions.close')}
                    </MyButton>
                    {count > 0 && (
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onClick={start}
                            disable={prepare.isPending || short}
                        >
                            <Lightning className="me-1 size-4" />
                            {t('prepare.confirm', { count })}
                        </MyButton>
                    )}
                </div>
            }
        >
            <div className="flex flex-col gap-3">
                <p className="text-body text-neutral-500">{t('prepare.why')}</p>
                {!estimate && !error && <Skeleton className="h-20 w-full rounded-md" />}
                {error && (
                    <p className="flex items-center gap-1.5 text-body text-danger-600">
                        <WarningCircle className="size-4" />
                        {error}
                    </p>
                )}
                {estimate && count === 0 && (
                    <p className="rounded-md border border-success-200 bg-success-50 p-3 text-body text-success-700">
                        {t('prepare.nothingToDo')}
                    </p>
                )}
                {estimate && count > 0 && (
                    <div className="flex flex-col gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-3">
                        <p className="text-subtitle font-semibold text-neutral-700">
                            {more
                                ? t('prepare.questionNext', {
                                      count,
                                      total: estimate.to_prepare,
                                  })
                                : t('prepare.question', { count })}
                        </p>
                        <p className="flex flex-wrap items-center gap-1.5 text-body text-neutral-600">
                            <Coins className="size-4 text-warning-600" />
                            {t('prepare.cost', {
                                credits: formatNumber(Math.round(estimate.estimated_credits)),
                                per: formatNumber(estimate.credits_per_lesson),
                            })}
                            {estimate.balance != null && (
                                <span className="text-neutral-500">
                                    {t('prepare.balance', {
                                        balance: formatNumber(Math.floor(estimate.balance)),
                                    })}
                                </span>
                            )}
                        </p>
                        {short && (
                            <p className="text-caption text-danger-600">{t('prepare.noCredits')}</p>
                        )}
                        {more && (
                            <p className="text-caption text-neutral-500">{t('prepare.runAgain')}</p>
                        )}
                    </div>
                )}
            </div>
        </MyDialog>
    );
}
