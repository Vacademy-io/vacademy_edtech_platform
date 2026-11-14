/**
 * Small pieces shared by the Plan & billing screens: feature mode badges, the
 * subscription status chip and the server-error → message mapping.
 */
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type {
    OpenCharge,
    PlanFeatureMode,
    StorefrontSubscription,
} from '@/services/ai-plans/storefront';

export const MODE_BADGE_CLASS: Record<PlanFeatureMode, string> = {
    INCLUDED: 'bg-success-50 text-success-700',
    ALLOWANCE: 'bg-primary-50 text-primary-600',
    CHARGED: 'bg-neutral-100 text-neutral-600',
};

export function ModeBadge({ mode, className }: { mode: PlanFeatureMode; className?: string }) {
    const { t } = useTranslation('aiPlans');
    return (
        <span
            className={cn(
                'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-2xs font-semibold',
                MODE_BADGE_CLASS[mode],
                className
            )}
        >
            {t(`mode.${mode}`)}
        </span>
    );
}

export type StatusKey =
    | 'pending'
    | 'active'
    | 'trial'
    | 'cancels'
    | 'paymentDue'
    | 'overdue'
    | 'ended';

/** What the status chip says, from the subscription and its open charge. */
export function subscriptionStatusKey(
    sub: StorefrontSubscription,
    charge: OpenCharge | null
): StatusKey {
    if (sub.status === 'PENDING') return 'pending';
    if (sub.status === 'GRACE') return 'overdue';
    if (sub.status === 'EXPIRED' || sub.status === 'CANCELLED') return 'ended';
    if (sub.cancel_at_period_end) return 'cancels';
    if (charge && ['DUE', 'LINK_SENT', 'FAILED'].includes(charge.status)) return 'paymentDue';
    if (sub.status === 'TRIAL') return 'trial';
    return 'active';
}

const STATUS_CLASS: Record<StatusKey, string> = {
    pending: 'bg-info-50 text-info-700',
    active: 'bg-success-50 text-success-700',
    trial: 'bg-info-50 text-info-700',
    cancels: 'bg-warning-50 text-warning-700',
    paymentDue: 'bg-warning-50 text-warning-700',
    overdue: 'bg-danger-50 text-danger-700',
    ended: 'bg-neutral-100 text-neutral-600',
};

export function StatusChip({ status, date }: { status: StatusKey; date?: string | null }) {
    const { t } = useTranslation('aiPlans');
    return (
        <span
            className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-semibold',
                STATUS_CLASS[status]
            )}
        >
            {t(`status.${status}`, { date: date ?? '' })}
        </span>
    );
}

const KNOWN_ERRORS = [
    'ALREADY_SUBSCRIBED',
    'NOT_OFFERED',
    'BUYER_STATE_REQUIRED',
    'INVALID_GSTIN',
    'CURRENCY_NOT_SUPPORTED',
    'RETURN_URL_NOT_ALLOWED',
    'CONTACT_SALES',
    'PAY_RENEWAL_FIRST',
    'OPEN_UPGRADE_EXISTS',
    'STOREFRONT_OFF',
    'PAYMENTS_DISABLED',
    'AUTOPAY_DISABLED',
    'AUTOPAY_UNAVAILABLE',
    'NO_SUBSCRIPTION',
    'CONFLICT',
    'DEBIT_IN_PROGRESS',
    'BUYER_ADDRESS_REQUIRED',
] as const;

/** The `aiPlans:errors.*` key for a server code (unknown codes get the generic one). */
export function errorMessageKey(code: string | null): string {
    return code && (KNOWN_ERRORS as readonly string[]).includes(code)
        ? `errors.${code}`
        : 'errors.generic';
}
