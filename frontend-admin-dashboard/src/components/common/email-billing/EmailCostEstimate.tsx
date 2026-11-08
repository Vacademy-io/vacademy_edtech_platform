import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { EnvelopeSimple, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TopUpModal } from '@/components/common/ai-credits/TopUpModal';
import { cn } from '@/lib/utils';
import {
    emailBillingKeys,
    useEmailCostEstimate,
    type EmailCostEstimateParams,
} from '@/services/email-billing-service';
import { getActiveLocale } from '@/lib/formatters';

export function formatEmailCredits(value: number | null | undefined): string {
    if (value == null) return '—';
    return value.toLocaleString(getActiveLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface EmailCostEstimateProps extends EmailCostEstimateParams {
    /** Told whether the send can go out; the parent disables its Send button on false. */
    onAllowedChange?: (allowed: boolean) => void;
    /** Pause the request, e.g. while the email channel is not selected. */
    enabled?: boolean;
    className?: string;
}

/**
 * One line before a bulk email send: how many emails it is, how many free emails are left this
 * month, and what it costs in credits. When the institute cannot pay for it the send would be
 * refused whole, so it says so and offers the credits top-up.
 *
 * Fails open: renders nothing (and reports allowed) while loading fails or there is no one to send to.
 */
export function EmailCostEstimate({
    onAllowedChange,
    enabled = true,
    className,
    ...params
}: EmailCostEstimateProps) {
    const queryClient = useQueryClient();
    const [topUpOpen, setTopUpOpen] = useState(false);
    const { estimate, isLoading, allowed } = useEmailCostEstimate(params, enabled);

    const reportRef = useRef(onAllowedChange);
    reportRef.current = onAllowedChange;
    useEffect(() => {
        reportRef.current?.(allowed);
    }, [allowed]);
    // Hidden means nothing to say: let the parent send.
    useEffect(() => () => reportRef.current?.(true), []);

    if (!enabled || params.recipients <= 0) return null;
    if (isLoading) return <Skeleton className={cn('h-9 w-full rounded-md', className)} />;
    if (!estimate) return null;

    const parts = [
        `≈ ${estimate.units.toLocaleString(getActiveLocale())} ${estimate.units === 1 ? 'email' : 'emails'}`,
        `${estimate.freeUnitsRemaining.toLocaleString(getActiveLocale())} free left this month`,
        estimate.credits > 0
            ? `${formatEmailCredits(estimate.credits)} credits`
            : 'no credits needed',
    ];
    if (estimate.balance != null) parts.push(`balance ${formatEmailCredits(estimate.balance)}`);

    return (
        <div className={cn('flex flex-col gap-2', className)}>
            <div className="flex items-start gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
                <EnvelopeSimple className="mt-0.5 size-4 shrink-0 text-neutral-500" />
                <p className="text-caption text-neutral-600">{parts.join(' · ')}</p>
            </div>
            {!estimate.allowed && (
                <div className="flex flex-col gap-2 rounded-md bg-danger-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-2">
                        <WarningCircle
                            className="mt-0.5 size-4 shrink-0 text-danger-600"
                            weight="fill"
                        />
                        <p className="text-caption text-danger-700">
                            Not enough free emails or credits for this send: needs{' '}
                            {formatEmailCredits(estimate.credits)} credits, you have{' '}
                            {formatEmailCredits(estimate.availableCredits ?? estimate.balance)}. Add
                            credits first.
                        </p>
                    </div>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        className="shrink-0"
                        onClick={() => setTopUpOpen(true)}
                    >
                        Add credits
                    </MyButton>
                </div>
            )}
            <TopUpModal
                open={topUpOpen}
                onOpenChange={(open) => {
                    setTopUpOpen(open);
                    // A top-up changes what this send can afford.
                    if (!open)
                        void queryClient.invalidateQueries({ queryKey: emailBillingKeys.all });
                }}
            />
        </div>
    );
}
