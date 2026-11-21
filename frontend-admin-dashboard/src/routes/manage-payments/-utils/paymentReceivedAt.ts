import type { PaymentLog } from '@/types/payment-logs';

const DAY_MS = 24 * 60 * 60 * 1000;
const TEN_YEARS_MS = 3650 * DAY_MS;

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * When a payment counts as received: the same rule the server uses to put it in a date window
 * (`PaymentLogRepository.PAID_AT`), so a row shows the date it was filed under.
 *
 * `created_at` is when the row was written and `date` the payment date. They agree for gateway
 * payments and same-day entries, which keep their exact time. When an admin records a payment
 * against an earlier day ("received 1 Jun", entered 23 Oct) the payment date wins and is shown
 * without a time, since `date` has none. A typed date more than ten years before the entry or
 * after the next day is a typo (year 0026), so the entry time is kept instead.
 */
export const paymentReceivedAt = (
    log?: Pick<PaymentLog, 'date' | 'created_at'> | null
): { value: string; hasTime: boolean } => {
    const created = log?.created_at ? new Date(log.created_at).getTime() : NaN;
    const paid = log?.date ? new Date(log.date).getTime() : NaN;
    if (Number.isNaN(created)) return { value: log?.date || '', hasTime: false };
    if (Number.isNaN(paid)) return { value: log?.created_at || '', hasTime: true };

    const backDated =
        utcDay(paid) !== utcDay(created) &&
        paid >= created - TEN_YEARS_MS &&
        paid <= created + DAY_MS;
    return backDated
        ? { value: log?.date || '', hasTime: false }
        : { value: log?.created_at || '', hasTime: true };
};
