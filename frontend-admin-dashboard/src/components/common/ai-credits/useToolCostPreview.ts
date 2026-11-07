import {
    useToolPricingQuery,
    useAiCreditsQuery,
    computeToolCredits,
} from '@/services/ai-credits/get-ai-credits';
import type { ToolKey, ToolParams, ToolPricingRow } from '@/services/ai-credits/get-ai-credits';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { planCoverageForTool, useAiPlanQuery, type PlanCoverage } from './aiPlan';

export interface ToolCostPreview {
    /** Parametric estimate in credits (computed locally, mirrors the backend). */
    credits: number | null;
    isLoading: boolean;
    currentBalance: number | null;
    balanceAfter: number | null;
    /** false when the estimate exceeds the current balance. null when balance unknown. */
    sufficient: boolean | null;
    /** true when running this would drop the balance below the low-balance threshold. */
    isLowBalanceAfter: boolean;
    /** The rate card row the estimate came from (DB-tunable), so a dialog can show the formula. */
    rate: ToolPricingRow | null;
    /**
     * How the institute's AI plan is expected to pay (included / allowance), or null when the
     * wallet pays. `credits` stays the list price; balanceAfter / sufficient use the wallet part.
     */
    coverage: PlanCoverage | null;
}

/**
 * Live "≈ N credits" preview for an AI tool. Computes the parametric cost locally
 * from cached rates (no per-keystroke network call) and cross-checks the institute
 * balance. Read-only — never deducts. Phase 1 of academy-credits.
 */
export function useToolCostPreview(
    toolKey: ToolKey,
    params: ToolParams,
    enabled = true,
    /**
     * Number of independent runs `params` describes (e.g. copies in a bulk
     * check). The backend charges each one separately, so the flat base and
     * the rounding apply per run — not once over the summed inputs.
     */
    runs = 1
): ToolCostPreview {
    const { data: pricing, isLoading: pricingLoading } = useToolPricingQuery(enabled);
    const { data: credits } = useAiCreditsQuery(enabled);

    const row = pricing?.tools.find((t) => t.tool_key === toolKey);
    const perRun = computeToolCredits(row, params);
    const estimated = perRun == null ? null : perRun * Math.max(0, runs);

    const { data: plan } = useAiPlanQuery(getCurrentInstituteId(), enabled);
    const coverage = planCoverageForTool(plan, toolKey, estimated);
    const walletCredits = coverage ? coverage.walletCredits : estimated;

    const currentBalance = credits ? parseFloat(credits.current_balance || '0') : null;
    const threshold = credits ? parseFloat(credits.low_balance_threshold || '0') : 0;
    const balanceAfter =
        currentBalance != null && walletCredits != null ? currentBalance - walletCredits : null;
    const sufficient = balanceAfter != null ? balanceAfter >= 0 : null;
    const isLowBalanceAfter = balanceAfter != null ? balanceAfter < threshold : false;

    return {
        credits: estimated,
        isLoading: pricingLoading,
        currentBalance,
        balanceAfter,
        sufficient,
        isLowBalanceAfter,
        rate: row ?? null,
        coverage,
    };
}
