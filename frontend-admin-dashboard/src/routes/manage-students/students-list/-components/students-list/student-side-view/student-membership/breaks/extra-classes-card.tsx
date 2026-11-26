import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CalendarPlus, CaretDown, CaretRight, Plus } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { useEnrolmentBreakSettings } from '@/services/enrolment-breaks';
import {
    EXTRA_CLASSES_QUERY_KEY,
    endExtraClass,
    useLearnerExtraClasses,
    type ExtraClass,
} from '@/services/extra-classes';
import { formatDay, lengthInDays, localToday, toneClasses } from './break-utils';
import { AddExtraClassDialog } from './add-extra-class-dialog';

interface ExtraClassesCardProps {
    userId: string;
    instituteId: string;
    learnerName?: string;
}

const STATE_TONE = { CURRENT: 'warning', UPCOMING: 'info', ENDED: 'neutral' } as const;

const ExtraClassRow = ({ item, onEnd }: { item: ExtraClass; onEnd?: () => void }) => {
    const { t } = useTranslation('manageStudentsBreaks');
    const days = item.from && item.to ? lengthInDays(item.from, item.to) : null;
    return (
        <li className="flex items-start justify-between gap-3 py-2 text-caption">
            <div className="min-w-0">
                <span className="block truncate font-semibold text-neutral-800">
                    {item.batch_label}
                </span>
                <span className="block text-neutral-500">
                    {formatDay(item.from)}
                    {item.to ? ` – ${formatDay(item.to)}` : ''}
                    {days ? ` · ${t('form.lengthDays', { count: days })}` : ''}
                </span>
                {(item.note || item.added_by || item.imported) && (
                    <span className="block text-neutral-500">
                        {item.note}
                        {item.note && (item.added_by || item.imported) ? ' · ' : ''}
                        {item.added_by
                            ? t('extra.addedBy', { name: item.added_by })
                            : item.imported
                              ? t('extra.imported')
                              : ''}
                    </span>
                )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span
                    className={cn(
                        'rounded-full px-2 py-0.5 text-caption font-semibold ring-1',
                        toneClasses[STATE_TONE[item.state]]
                    )}
                >
                    {t(`extra.state.${item.state}`)}
                </span>
                {onEnd && (
                    <MyButton type="button" buttonType="secondary" scale="small" onClick={onEnd}>
                        {item.state === 'UPCOMING' ? t('extra.remove') : t('extra.end')}
                    </MyButton>
                )}
            </div>
        </li>
    );
};

/**
 * Extra classes for one learner: another batch they attend for a few days (a make-up class), with
 * no fee and no message. Shown next to Breaks and holds and gated by the same institute switch;
 * when it is off, existing extra classes stay visible so they can still be ended.
 */
export const ExtraClassesCard = ({ userId, instituteId, learnerName }: ExtraClassesCardProps) => {
    const { t } = useTranslation('manageStudentsBreaks');
    const queryClient = useQueryClient();
    const settings = useEnrolmentBreakSettings();
    const { data, isLoading, isError, refetch } = useLearnerExtraClasses(
        userId,
        instituteId,
        settings.configured
    );
    const batchTerm = getTerminology(ContentTerms.Batch, SystemTerms.Batch);

    const [adding, setAdding] = useState(false);
    const [endOf, setEndOf] = useState<ExtraClass | null>(null);
    const [showHistory, setShowHistory] = useState(false);

    const endMutation = useMutation({
        mutationFn: (x: ExtraClass) => endExtraClass(instituteId, x.id),
        onSuccess: (res) => {
            toast.success(res.result === 'REMOVED' ? t('extra.toast.removed') : t('extra.toast.ended'));
            queryClient.invalidateQueries({ queryKey: [EXTRA_CLASSES_QUERY_KEY] });
            setEndOf(null);
        },
        onError: (err: { response?: { data?: { message?: string } }; message?: string }) => {
            toast.error(err?.response?.data?.message || err?.message || t('toast.failed'));
        },
    });

    const items = data?.extra_classes ?? [];
    const live = items.filter((x) => x.state !== 'ENDED');
    const past = items.filter((x) => x.state === 'ENDED');

    if (!userId || !settings.configured) return null;
    if (!settings.enabled && live.length === 0) return null;

    return (
        <section
            className="rounded-lg border border-neutral-200 bg-card p-3"
            aria-labelledby="extra-classes-title"
        >
            <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-start gap-2">
                    <span className="rounded-md bg-primary-50 p-1.5 text-primary-500">
                        <CalendarPlus className="size-4" />
                    </span>
                    <div className="min-w-0">
                        <h3
                            id="extra-classes-title"
                            className="text-body font-semibold text-neutral-800"
                        >
                            {t('extra.title')}
                        </h3>
                        <p className="text-caption text-neutral-500">
                            {t('extra.subtitle', { batch: batchTerm.toLowerCase() })}
                        </p>
                    </div>
                </div>
                {settings.enabled && !isLoading && !isError && (
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        onClick={() => setAdding(true)}
                    >
                        <Plus className="me-1 size-3.5" />
                        {t('extra.add')}
                    </MyButton>
                )}
            </div>

            <div className="mt-3 space-y-2">
                {isLoading && <Skeleton className="h-12 w-full" />}

                {isError && (
                    <div className="flex items-center justify-between gap-2 rounded-md bg-danger-50 p-3 text-caption text-danger-700 ring-1 ring-danger-200">
                        <span>{t('extra.error')}</span>
                        <MyButton
                            type="button"
                            buttonType="text"
                            scale="small"
                            onClick={() => refetch()}
                        >
                            {t('card.retry')}
                        </MyButton>
                    </div>
                )}

                {!isLoading && !isError && live.length === 0 && (
                    <p className="rounded-md bg-neutral-50 p-3 text-caption text-neutral-500">
                        {t('extra.empty')}
                    </p>
                )}

                {live.length > 0 && (
                    <ul className="divide-y divide-neutral-100">
                        {live.map((x) => (
                            <ExtraClassRow key={x.id} item={x} onEnd={() => setEndOf(x)} />
                        ))}
                    </ul>
                )}

                {past.length > 0 && (
                    <div className="border-t border-neutral-100 pt-2">
                        <button
                            type="button"
                            onClick={() => setShowHistory((v) => !v)}
                            className="flex items-center gap-1 rounded-sm text-caption font-semibold text-neutral-600 hover:text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                            aria-expanded={showHistory}
                        >
                            {showHistory ? (
                                <CaretDown className="size-3" />
                            ) : (
                                <CaretRight className="size-3 rtl:rotate-180" />
                            )}
                            {t('extra.history', { count: past.length })}
                        </button>
                        {showHistory && (
                            <ul className="mt-1 divide-y divide-neutral-100">
                                {past.map((x) => (
                                    <ExtraClassRow key={x.id} item={x} />
                                ))}
                            </ul>
                        )}
                    </div>
                )}
            </div>

            {adding && (
                <AddExtraClassDialog
                    onClose={() => setAdding(false)}
                    userId={userId}
                    instituteId={instituteId}
                    learnerName={learnerName}
                    today={localToday()}
                    batchTerm={batchTerm}
                />
            )}
            <AlertDialog open={endOf !== null} onOpenChange={(o) => !o && setEndOf(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {endOf?.state === 'UPCOMING'
                                ? t('extra.confirm.removeTitle')
                                : t('extra.confirm.endTitle')}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {endOf &&
                                (endOf.state === 'UPCOMING'
                                    ? t('extra.confirm.removeDescription', {
                                          batch: endOf.batch_label,
                                      })
                                    : t('extra.confirm.endDescription', {
                                          batch: endOf.batch_label,
                                      }))}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('extra.confirm.keep')}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => {
                                e.preventDefault();
                                if (endOf) endMutation.mutate(endOf);
                            }}
                            disabled={endMutation.isPending}
                        >
                            {endOf?.state === 'UPCOMING' ? t('extra.remove') : t('extra.end')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </section>
    );
};
