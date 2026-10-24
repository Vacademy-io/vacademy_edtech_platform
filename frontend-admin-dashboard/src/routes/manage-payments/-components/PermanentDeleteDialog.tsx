import { useState, type ReactNode } from 'react';
import {
    ArrowCounterClockwise,
    ClockCounterClockwise,
    FileX,
    Hash,
    Trash,
    WarningCircle,
} from '@phosphor-icons/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
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
import { MyInput } from '@/components/design-system/input';
import { deletePaymentLog, serverErrorMessage } from '@/services/payment-logs';
import { deleteInvoicePermanently } from '@/services/invoice-service';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { cn } from '@/lib/utils';

/** What is about to be deleted, and how to name it in the confirmation. */
export interface PermanentDeleteTarget {
    kind: 'payment' | 'invoice';
    id: string;
    /** Amount or invoice number, shown in the title. */
    label: string;
}

/** The word the admin has to type — a permanent delete should never be one stray click. */
const CONFIRM_WORD = 'DELETE';

/** Every cached view a permanent delete changes (same set a void changes). */
const QUERY_KEYS_TOUCHED_BY_DELETE: string[][] = [
    ['payment-logs-all'],
    ['payment-billing-summary'],
    ['payment-billing-summary-dash'],
    ['payment-outstanding-learners'],
    ['payment-instalment-forecast'],
    ['payment-outstanding-dash'],
    ['payment-analytics'],
    ['collection-summary-dash'],
    ['payment-log-invoices'],
    ['user-account-summary'],
    ['user-account-ledger'],
    ['user-invoices'],
    ['cpo-side-view'],
];

/** One consequence of the delete, as an icon + a sentence. */
function Consequence({ icon, children }: { icon: ReactNode; children: ReactNode }) {
    return (
        <li className="flex items-start gap-2.5">
            <span className="mt-0.5 shrink-0 text-neutral-500">{icon}</span>
            <span className="text-body text-neutral-700">{children}</span>
        </li>
    );
}

interface PermanentDeleteDialogProps {
    target: PermanentDeleteTarget | null;
    onOpenChange: (open: boolean) => void;
    onDeleted?: () => void;
}

/**
 * Confirms and performs a PERMANENT delete of a payment or an invoice. Only rendered where the
 * viewer's role has the Display Settings permission (off by default); the server enforces it
 * again. Every delete — and every refused attempt — lands in the admin activity log.
 */
export function PermanentDeleteDialog({
    target,
    onOpenChange,
    onDeleted,
}: PermanentDeleteDialogProps) {
    const { t } = useTranslation('manageStudentsPaymentHistory');
    const queryClient = useQueryClient();
    const [typed, setTyped] = useState('');

    const mutation = useMutation({
        mutationFn: async (input: PermanentDeleteTarget) => {
            if (input.kind === 'payment') {
                await deletePaymentLog(input.id);
                return;
            }
            const instituteId = getCurrentInstituteId();
            if (!instituteId) throw new Error('Institute ID not found');
            await deleteInvoicePermanently(input.id, instituteId);
        },
        onSuccess: (_result, input) => {
            QUERY_KEYS_TOUCHED_BY_DELETE.forEach((queryKey) =>
                queryClient.invalidateQueries({ queryKey })
            );
            toast.success(
                input.kind === 'payment'
                    ? t('permanentDelete.paymentDeletedToast', { label: input.label })
                    : t('permanentDelete.invoiceDeletedToast', { label: input.label })
            );
            close(false);
            onDeleted?.();
        },
        onError: (err: unknown) => {
            const message = serverErrorMessage(err);
            toast.error(message || t('permanentDelete.errorToast'));
        },
    });

    // Stays open while the request runs, so a slow delete can't be mistaken for a finished one.
    const close = (open: boolean) => {
        if (!open && mutation.isPending) return;
        if (!open) setTyped('');
        onOpenChange(open);
    };

    const isPayment = target?.kind === 'payment';
    const confirmed = typed.trim().toUpperCase() === CONFIRM_WORD;
    const submit = () => {
        if (target && confirmed && !mutation.isPending) mutation.mutate(target);
    };
    const iconProps = { size: 16, weight: 'duotone' as const };

    return (
        <AlertDialog open={!!target} onOpenChange={close}>
            <AlertDialogContent className="max-w-md gap-5">
                <AlertDialogHeader className="flex-row items-start gap-3 space-y-0 text-left">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-danger-50 text-danger-600">
                        <WarningCircle size={22} weight="duotone" />
                    </span>
                    <div className="flex min-w-0 flex-col gap-1">
                        <AlertDialogTitle className="text-h3 font-semibold text-neutral-800">
                            {isPayment
                                ? t('permanentDelete.paymentTitle', { label: target?.label ?? '' })
                                : t('permanentDelete.invoiceTitle', { label: target?.label ?? '' })}
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-caption font-medium text-danger-600">
                            {t('permanentDelete.cannotUndo')}
                        </AlertDialogDescription>
                    </div>
                </AlertDialogHeader>

                <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                    <p className="mb-3 text-2xs font-semibold uppercase tracking-wide text-neutral-500">
                        {t('permanentDelete.whatHappens')}
                    </p>
                    <ul className="flex flex-col gap-2.5">
                        {isPayment ? (
                            <>
                                <Consequence icon={<Trash {...iconProps} />}>
                                    {t('permanentDelete.payment.removed')}
                                </Consequence>
                                <Consequence icon={<ArrowCounterClockwise {...iconProps} />}>
                                    {t('permanentDelete.payment.balance')}
                                </Consequence>
                                <Consequence icon={<FileX {...iconProps} />}>
                                    {t('permanentDelete.payment.invoice')}
                                </Consequence>
                            </>
                        ) : (
                            <>
                                <Consequence icon={<Trash {...iconProps} />}>
                                    {t('permanentDelete.invoice.removed')}
                                </Consequence>
                                <Consequence icon={<ArrowCounterClockwise {...iconProps} />}>
                                    {t('permanentDelete.invoice.balance')}
                                </Consequence>
                                <Consequence icon={<Hash {...iconProps} />}>
                                    {t('permanentDelete.invoice.number')}
                                </Consequence>
                            </>
                        )}
                        <Consequence icon={<ClockCounterClockwise {...iconProps} />}>
                            {t('permanentDelete.auditLog')}
                        </Consequence>
                    </ul>
                </div>

                <form
                    className="flex flex-col gap-1.5"
                    onSubmit={(e) => {
                        e.preventDefault();
                        submit();
                    }}
                >
                    <label
                        htmlFor="permanent-delete-confirm"
                        className="text-body text-neutral-600"
                    >
                        {t('permanentDelete.typePrefix')}{' '}
                        <span className="rounded-md bg-danger-50 px-1.5 py-0.5 font-mono text-caption font-semibold text-danger-700">
                            {CONFIRM_WORD}
                        </span>{' '}
                        {t('permanentDelete.typeSuffix')}
                    </label>
                    <MyInput
                        id="permanent-delete-confirm"
                        inputPlaceholder={CONFIRM_WORD}
                        input={typed}
                        onChangeFunction={(e) => setTyped(e.target.value)}
                        size="medium"
                        className={cn(
                            'w-full text-body text-neutral-800 sm:w-full',
                            confirmed && 'border-danger-300'
                        )}
                        autoFocus
                        autoComplete="off"
                    />
                </form>

                <AlertDialogFooter className="gap-2 sm:gap-0">
                    <AlertDialogCancel disabled={mutation.isPending}>
                        {t('permanentDelete.keep')}
                    </AlertDialogCancel>
                    <AlertDialogAction
                        disabled={!confirmed || mutation.isPending}
                        onClick={(e) => {
                            // Close only once the server has confirmed (see onSuccess).
                            e.preventDefault();
                            submit();
                        }}
                        className="gap-2 bg-danger-600 hover:bg-danger-700"
                    >
                        <Trash size={16} />
                        {mutation.isPending
                            ? t('permanentDelete.deleting')
                            : t('permanentDelete.confirm')}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
