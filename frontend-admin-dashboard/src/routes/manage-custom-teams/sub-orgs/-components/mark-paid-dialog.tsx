import { useEffect, useState } from 'react';
import { OfflinePaymentFields } from '@/components/common/payments/OfflinePaymentFields';
import { toOfflinePaymentDetailsPayload, type OfflinePaymentDetails } from '@/services/offline-payment-modes';
import { useTranslation } from 'react-i18next';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useMutation } from '@tanstack/react-query';
import { MyButton } from '@/components/design-system/button';
import { markInvoicePaidManually } from '../../-services/custom-team-services';

interface MarkPaidDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    invoiceId: string;
    invoiceNumber?: string;
    /** Refresh callback fired on a successful manual-payment record. */
    onSuccess?: () => void;
}

/**
 * Small dialog wrapping the {@code POST /v1/invoices/{id}/mark-paid-manual} endpoint.
 * Both fields are optional — `transactionId` ends up on the PaymentLog's
 * paymentSpecificData JSON (audit trail) and `notes` shows on the side-view detail
 * panel + confirmation email. Same payload shape as the manage-students surface
 * uses, so behaviour is consistent across both entry points.
 */
export function MarkPaidDialog({
    open,
    onOpenChange,
    invoiceId,
    invoiceNumber,
    onSuccess,
}: MarkPaidDialogProps) {
    const { t } = useTranslation('manageCustomTeamsMarkPaidDialog');
    const [details, setDetails] = useState<OfflinePaymentDetails>({});
    const [detailsError, setDetailsError] = useState<string | null>(null);
    const [notes, setNotes] = useState<string>('');

    useEffect(() => {
        if (!open) return;
        setDetails({});
        setNotes('');
    }, [open]);

    const mutation = useMutation({
        mutationFn: () =>
            markInvoicePaidManually(invoiceId, {
                transaction_id: details.reference?.trim() || undefined,
                notes: notes.trim() || undefined,
                payment_details: toOfflinePaymentDetailsPayload(details),
            }),
        onSuccess: () => {
            toast.success(t('toasts.markedPaid', { invoice: invoiceNumber || invoiceId }));
            onSuccess?.();
            onOpenChange(false);
        },
        onError: (err: any) => {
            toast.error(
                err?.response?.data?.message || err?.message || t('toasts.failed')
            );
        },
    });

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[420px]">
                <DialogHeader>
                    <DialogTitle>{t('title')}</DialogTitle>
                    <DialogDescription>
                        {t('descriptionPrefix')}{' '}
                        {invoiceNumber ? <strong>{invoiceNumber}</strong> : t('thisInvoice')}{' '}
                        {t('descriptionSuffix')}
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 py-1">
                    {/* How it was paid: mode, option (e.g. PhonePe), reference, proof. */}
                    <OfflinePaymentFields value={details} onChange={setDetails} onErrorChange={setDetailsError} />
                    <div className="space-y-1">
                        <Label htmlFor="mp-notes">{t('fields.notes')}</Label>
                        <Input
                            id="mp-notes"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder={t('fields.notesPlaceholder')}
                        />
                    </div>
                </div>
                <DialogFooter className="gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        onClick={() => onOpenChange(false)}
                        disable={mutation.isPending}
                    >
                        {t('cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="small"
                        onClick={() => mutation.mutate()}
                        disable={mutation.isPending || !!detailsError}
                    >
                        {mutation.isPending ? (
                            <>
                                <Loader2 className="size-4 animate-spin" />
                                {t('saving')}
                            </>
                        ) : (
                            t('markAsPaid')
                        )}
                    </MyButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
