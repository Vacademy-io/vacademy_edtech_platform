import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CaretDown, CaretRight, Plus, Receipt } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
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
import { formatCurrency } from '@/lib/formatters';
import { fallbackCurrency } from '@/utils/institute-currency';
import {
    ONE_OFF_DUES_QUERY_KEY,
    cancelOneOffDue,
    useLearnerOneOffDues,
    useOneOffDueSettings,
    type OneOffDue,
} from '@/services/one-off-dues';
import {
    formatDay,
    localToday,
    toneClasses,
} from '../student-membership/breaks/break-utils';
import { AddOneOffChargeDialog } from './add-one-off-charge-dialog';

interface OneOffChargesCardProps {
    userId: string;
    instituteId: string;
    learnerName?: string;
    /** Called after a charge is added or cancelled, so the invoice list and summary refresh. */
    onChanged?: () => void;
}

const STATUS_TONE = { DUE: 'warning', PAID: 'success', CANCELLED: 'neutral' } as const;
const SUCCESS_TONE = 'bg-success-50 text-success-700 ring-success-200';

const formatMoney = (amount: number, currency: string | null) =>
    formatCurrency(Number(amount), currency || fallbackCurrency());

const ChargeRow = ({
    due,
    today,
    onCancel,
}: {
    due: OneOffDue;
    today: string;
    onCancel?: () => void;
}) => {
    const { t } = useTranslation('manageStudentsOneOffDues');
    const overdue = due.status === 'DUE' && due.due_date < today;
    const tone = STATUS_TONE[due.status] ?? 'neutral';
    return (
        <li className="flex items-start justify-between gap-3 py-2 text-caption">
            <div className="min-w-0">
                <span className="block truncate font-semibold text-neutral-800">{due.title}</span>
                <span className="block text-neutral-500">
                    {formatMoney(due.amount, due.currency)}
                    {' · '}
                    <span className={cn(overdue && 'font-semibold text-danger-600')}>
                        {overdue
                            ? t('row.overdueSince', { date: formatDay(due.due_date) })
                            : t('row.dueOn', { date: formatDay(due.due_date) })}
                    </span>
                    {due.invoice_number ? ` · ${due.invoice_number}` : ''}
                </span>
                {due.course_label && (
                    <span className="block truncate text-neutral-500">{due.course_label}</span>
                )}
                {due.note && <span className="block text-neutral-500">{due.note}</span>}
                {due.source_type && due.source_type !== 'MANUAL' && (
                    <span className="block text-neutral-500">
                        {t(`source.${due.source_type}`, { defaultValue: t('source.OTHER') })}
                    </span>
                )}
                {due.status === 'CANCELLED' && due.cancel_reason && (
                    <span className="block text-neutral-500">
                        {t('row.cancelReason', { reason: due.cancel_reason })}
                    </span>
                )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span
                    className={cn(
                        'rounded-full px-2 py-0.5 text-caption font-semibold ring-1',
                        tone === 'success' ? SUCCESS_TONE : toneClasses[tone]
                    )}
                >
                    {t(`status.${due.status}`)}
                </span>
                {onCancel && (
                    <MyButton type="button" buttonType="secondary" scale="small" onClick={onCancel}>
                        {t('row.cancel')}
                    </MyButton>
                )}
            </div>
        </li>
    );
};

/**
 * One-off charges for one learner: a single extra charge (e.g. a bridge class) that the learner
 * pays online like an invoice. Hidden unless the institute switched the feature on; when it is
 * switched off later, charges still due stay visible so they can be cancelled.
 */
export const OneOffChargesCard = ({
    userId,
    instituteId,
    learnerName,
    onChanged,
}: OneOffChargesCardProps) => {
    const { t } = useTranslation('manageStudentsOneOffDues');
    const queryClient = useQueryClient();
    const settings = useOneOffDueSettings();
    const { data, isLoading, isError, refetch } = useLearnerOneOffDues(
        userId,
        instituteId,
        settings.configured
    );
    const today = localToday();

    const [adding, setAdding] = useState(false);
    const [cancelOf, setCancelOf] = useState<OneOffDue | null>(null);
    const [reason, setReason] = useState('');
    const [showHistory, setShowHistory] = useState(false);

    const cancelMutation = useMutation({
        mutationFn: (d: OneOffDue) => cancelOneOffDue(instituteId, d.id, reason.trim() || null),
        onSuccess: () => {
            toast.success(t('toast.cancelled'));
            queryClient.invalidateQueries({ queryKey: [ONE_OFF_DUES_QUERY_KEY] });
            onChanged?.();
            setCancelOf(null);
            setReason('');
        },
        onError: (err: { response?: { data?: { message?: string } }; message?: string }) => {
            toast.error(err?.response?.data?.message || err?.message || t('toast.failed'));
        },
    });

    const dues = data?.dues ?? [];
    const open = dues.filter((d) => d.status === 'DUE');
    const done = dues.filter((d) => d.status !== 'DUE');

    if (!userId || !settings.configured) return null;
    if (!settings.enabled && open.length === 0) return null;

    return (
        <section
            className="rounded-lg border border-neutral-200 bg-card p-3"
            aria-labelledby="one-off-charges-title"
        >
            <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-start gap-2">
                    <span className="rounded-md bg-primary-50 p-1.5 text-primary-500">
                        <Receipt className="size-4" />
                    </span>
                    <div className="min-w-0">
                        <h3
                            id="one-off-charges-title"
                            className="text-body font-semibold text-neutral-800"
                        >
                            {t('card.title')}
                        </h3>
                        <p className="text-caption text-neutral-500">{t('card.subtitle')}</p>
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
                        {t('card.add')}
                    </MyButton>
                )}
            </div>

            <div className="mt-3 space-y-2">
                {isLoading && <Skeleton className="h-12 w-full" />}

                {isError && (
                    <div className="flex items-center justify-between gap-2 rounded-md bg-danger-50 p-3 text-caption text-danger-700 ring-1 ring-danger-200">
                        <span>{t('card.error')}</span>
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

                {!isLoading && !isError && open.length === 0 && (
                    <p className="rounded-md bg-neutral-50 p-3 text-caption text-neutral-500">
                        {t('card.empty')}
                    </p>
                )}

                {open.length > 0 && (
                    <ul className="divide-y divide-neutral-100">
                        {open.map((d) => (
                            <ChargeRow
                                key={d.id}
                                due={d}
                                today={today}
                                onCancel={() => setCancelOf(d)}
                            />
                        ))}
                    </ul>
                )}

                {done.length > 0 && (
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
                            {t('card.history', { count: done.length })}
                        </button>
                        {showHistory && (
                            <ul className="mt-1 divide-y divide-neutral-100">
                                {done.map((d) => (
                                    <ChargeRow key={d.id} due={d} today={today} />
                                ))}
                            </ul>
                        )}
                    </div>
                )}
            </div>

            {adding && (
                <AddOneOffChargeDialog
                    onClose={() => setAdding(false)}
                    userId={userId}
                    instituteId={instituteId}
                    learnerName={learnerName}
                    today={today}
                    currency={data?.default_currency ?? null}
                    courses={data?.courses ?? []}
                    onAdded={onChanged}
                />
            )}
            <AlertDialog
                open={cancelOf !== null}
                onOpenChange={(o) => {
                    if (!o) {
                        setCancelOf(null);
                        setReason('');
                    }
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('confirm.title')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {cancelOf &&
                                t('confirm.description', {
                                    title: cancelOf.title,
                                    amount: formatMoney(cancelOf.amount, cancelOf.currency),
                                })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <Textarea
                        rows={2}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder={t('confirm.reasonPlaceholder')}
                        maxLength={500}
                    />
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('confirm.keep')}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => {
                                e.preventDefault();
                                if (cancelOf) cancelMutation.mutate(cancelOf);
                            }}
                            disabled={cancelMutation.isPending}
                        >
                            {t('confirm.cancelCharge')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </section>
    );
};
