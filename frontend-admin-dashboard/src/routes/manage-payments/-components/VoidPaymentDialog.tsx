import { useState } from 'react';
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
import { formatMoney } from '@/utils/payment-currency';
import { serverErrorMessage, voidPaymentLog, type PaymentVoidResult } from '@/services/payment-logs';

/** The payment a void is about to act on — enough to name it in the confirmation. */
export interface VoidPaymentTarget {
    paymentLogId: string;
    amount?: number | null;
    currency?: string | null;
}

/**
 * Every cached view a void changes: the payments table and its cards, the Due / Outstanding
 * lists, and the learner's side view (account summary, ledger, invoices, instalments).
 */
const QUERY_KEYS_TOUCHED_BY_VOID: string[][] = [
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

interface VoidPaymentDialogProps {
    target: VoidPaymentTarget | null;
    onOpenChange: (open: boolean) => void;
    onVoided?: (result: PaymentVoidResult) => void;
}

/**
 * Confirms and voids a payment an admin recorded by mistake — what institutes mean by "delete a
 * payment". Terminal and money-moving, so it sits behind an AlertDialog like invoice Cancel.
 * Shared by Manage Payments and the learner's payment-history panel.
 */
export function VoidPaymentDialog({ target, onOpenChange, onVoided }: VoidPaymentDialogProps) {
    const { t } = useTranslation('manageStudentsPaymentHistory');
    const queryClient = useQueryClient();
    const [reason, setReason] = useState('');

    const amountLabel = target
        ? formatMoney(target.amount ?? 0, target.currency || 'INR', { maximumFractionDigits: 2 })
        : '';

    // The dialog closes as soon as the admin confirms, so everything the toast needs travels with
    // the mutation rather than being read back from `target`, which is null by then.
    const mutation = useMutation({
        mutationFn: (input: { paymentLogId: string; reason: string; amountLabel: string }) =>
            voidPaymentLog(input.paymentLogId, input.reason),
        onSuccess: (result, input) => {
            QUERY_KEYS_TOUCHED_BY_VOID.forEach((queryKey) =>
                queryClient.invalidateQueries({ queryKey })
            );
            toast.success(t('voidPayment.successToast', { amount: input.amountLabel }));
            onVoided?.(result);
        },
        onError: (err: unknown) => {
            const message = serverErrorMessage(err);
            toast.error(message || t('voidPayment.errorToast'));
        },
    });

    const close = (open: boolean) => {
        if (!open) setReason('');
        onOpenChange(open);
    };

    return (
        <AlertDialog open={!!target} onOpenChange={close}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        {t('voidPayment.dialog.title', { amount: amountLabel })}
                    </AlertDialogTitle>
                    <AlertDialogDescription>{t('voidPayment.dialog.description')}</AlertDialogDescription>
                </AlertDialogHeader>
                <MyInput
                    label={t('voidPayment.dialog.reasonLabel')}
                    inputPlaceholder={t('voidPayment.dialog.reasonPlaceholder')}
                    input={reason}
                    onChangeFunction={(e) => setReason(e.target.value)}
                    size="medium"
                    className="w-full"
                />
                <AlertDialogFooter>
                    <AlertDialogCancel>{t('voidPayment.dialog.keep')}</AlertDialogCancel>
                    <AlertDialogAction
                        disabled={mutation.isPending}
                        onClick={() => {
                            if (target) {
                                mutation.mutate({
                                    paymentLogId: target.paymentLogId,
                                    reason,
                                    amountLabel,
                                });
                            }
                            close(false);
                        }}
                        className="bg-danger-600 hover:bg-danger-700"
                    >
                        {t('voidPayment.dialog.confirm')}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
