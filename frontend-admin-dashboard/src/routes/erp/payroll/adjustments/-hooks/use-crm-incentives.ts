import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MonthValue } from '@/components/design-system/month-picker';
import {
    fetchIncentivePreview,
    hrKeys,
    incentiveKeys,
    materializeIncentives,
} from '@/routes/erp/-shared/hr-service';

/**
 * Query plumbing for Variable Pay → Incentives.
 *
 * Nothing here fires on mount. The preview re-derives collected revenue from the
 * payment log for a whole month, and its answer depends on rates the admin is
 * still typing — auto-running it would both be expensive and show numbers for a
 * half-entered commission percentage.
 */

export interface IncentiveTerms {
    /** Percentage of collected revenue, 0–50. Undefined when only a fixed fee applies. */
    commissionPct?: number;
    /** Flat amount per paying lead. Undefined when only a commission applies. */
    fixedPerConversion?: number;
}

export function useIncentivePreview(month: MonthValue, terms: IncentiveTerms) {
    return useQuery({
        queryKey: incentiveKeys.preview(
            month.year,
            month.month,
            terms.commissionPct,
            terms.fixedPerConversion
        ),
        queryFn: () =>
            fetchIncentivePreview({
                year: month.year,
                month: month.month,
                commissionPct: terms.commissionPct,
                fixedPerConversion: terms.fixedPerConversion,
            }),
        enabled: false,
    });
}

/**
 * Writes CRM_INCENTIVE adjustments onto the PAYOUT period's payroll.
 *
 * The invalidation targets the payout month's adjustments, not the earning
 * month's — the money appears on the run you are about to pay, which is the whole
 * reason the two months are asked for separately.
 */
export function useMaterializeIncentives(earningMonth: MonthValue, payoutMonth: MonthValue) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (terms: IncentiveTerms) =>
            materializeIncentives({
                year: earningMonth.year,
                month: earningMonth.month,
                commissionPct: terms.commissionPct,
                fixedPerConversion: terms.fixedPerConversion,
                payoutYear: payoutMonth.year,
                payoutMonth: payoutMonth.month,
            }),
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: hrKeys.adjustments(payoutMonth.year, payoutMonth.month),
            });
        },
    });
}

/** Guard the two rate inputs share: the backend computes zero for everyone otherwise. */
export function hasUsableTerms(terms: IncentiveTerms): boolean {
    return (
        (terms.commissionPct !== undefined && terms.commissionPct > 0) ||
        (terms.fixedPerConversion !== undefined && terms.fixedPerConversion > 0)
    );
}

/** Clamped client-side so a typo cannot ask for a 500% commission; the server re-checks. */
export const MAX_COMMISSION_PCT = 50;
