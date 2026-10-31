import type { StatusType } from '@/components/design-system/status-chips';
import type { PaymentLogEntry } from '@/types/payment-logs';

const PAYMENT_STATUS_META: Record<string, { label: string; chip: StatusType }> = {
    PAID: { label: 'Paid', chip: 'SUCCESS' },
    FAILED: { label: 'Failed', chip: 'DANGER' },
    PAYMENT_PENDING: { label: 'Pending', chip: 'WARNING' },
    NOT_INITIATED: { label: 'Not initiated', chip: 'INFO' },
    ABANDONED: { label: 'Abandoned checkout', chip: 'INFO' },
    // A voided invoice row; a voided payment is labelled from its own status below.
    CANCELLED: { label: 'Cancelled', chip: 'INFO' },
    VOIDED: { label: 'Voided', chip: 'DANGER' },
};

/** How a payment status reads on screen; an unknown status falls through to its raw value. */
export const paymentStatusMeta = (status?: string) =>
    PAYMENT_STATUS_META[(status || '').toUpperCase()] ?? {
        label: status || '—',
        chip: 'INFO' as StatusType,
    };

/**
 * The status to show for one payment row. The listing reports a voided payment as CANCELLED, so a
 * voided log is labelled from its own payment_status instead.
 */
export const entryPaymentStatus = (entry: PaymentLogEntry): string => {
    const log = entry.payment_log;
    if ((log?.payment_status || '').toUpperCase() === 'VOIDED') return 'VOIDED';
    return entry.current_payment_status || log?.payment_status || '';
};
