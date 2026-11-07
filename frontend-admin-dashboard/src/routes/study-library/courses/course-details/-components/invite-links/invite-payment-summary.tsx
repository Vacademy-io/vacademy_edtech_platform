import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type {
    InviteLinkDataInterface,
    InvitePaymentSummary,
} from '@/schemas/study-library/invite-links-schema';

/**
 * The payment summary for one batch of an invite. An invite can span several
 * batches, each with its own payment option, so callers always say which.
 */
export const findPaymentSummary = (
    invite: Pick<InviteLinkDataInterface, 'payment_summaries'>,
    packageSessionId: string
): InvitePaymentSummary | null =>
    invite.payment_summaries?.find((s) => s.package_session_id === packageSessionId) ?? null;

/**
 * "[One-time] Gold · ₹499" / "[Subscription] Gold · 3 plans · ₹499 – ₹4,999" /
 * "[Free] Free plan", plus "needs approval" when the option gates enrolment.
 * FREE has no price to show; the option name alone still tells the admin which
 * option it is.
 */
export const InvitePaymentSummaryLine = ({
    summary,
    className,
}: {
    summary: InvitePaymentSummary;
    className?: string;
}) => {
    const { t } = useTranslation('studyLibraryCourseDetailsInviteDetailsComponent');

    const typeLabel = (() => {
        switch (summary.type) {
            case 'FREE':
                return t('payment.type.free');
            case 'ONE_TIME':
                return t('payment.type.oneTime');
            case 'SUBSCRIPTION':
                return t('payment.type.subscription');
            case 'DONATION':
                return t('payment.type.donation');
            case 'CPO':
                return t('payment.type.feeStructure');
            default:
                return summary.type || t('payment.type.unknown');
        }
    })();

    const parts: string[] = [];
    if (summary.payment_option_name) parts.push(summary.payment_option_name);
    if (summary.type !== 'FREE' && summary.min_price != null) {
        if (summary.plan_count > 1)
            parts.push(t('payment.planCount', { count: summary.plan_count }));
        const money = (n: number) =>
            summary.currency ? formatCurrency(n, summary.currency) : String(n);
        parts.push(
            summary.max_price != null && summary.max_price !== summary.min_price
                ? `${money(summary.min_price)} – ${money(summary.max_price)}`
                : money(summary.min_price)
        );
    }

    return (
        <span className={cn('flex min-w-0 flex-wrap items-center gap-1.5', className)}>
            <Badge
                variant="outline"
                className={cn(
                    'shrink-0 font-normal shadow-none',
                    summary.type === 'FREE'
                        ? 'border-success-200 bg-success-50 text-success-700'
                        : 'border-primary-200 bg-primary-50 text-primary-500'
                )}
            >
                {typeLabel}
            </Badge>
            {parts.length > 0 && <span className="truncate">{parts.join(' · ')}</span>}
            {summary.require_approval && (
                <span className="text-warning-700">· {t('payment.needsApproval')}</span>
            )}
        </span>
    );
};
