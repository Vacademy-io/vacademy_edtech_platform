import { Sparkle, Warning } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { coverageLabel, type PlanCoverage } from './aiPlan';

interface ToolCostBadgeProps {
    /** Estimated parametric cost in credits. */
    credits: number | null;
    /** false → not enough balance (badge turns amber + warning). */
    sufficient?: boolean | null;
    loading?: boolean;
    className?: string;
    /** The institute's AI plan pays (see useToolCostPreview().coverage). */
    coverage?: PlanCoverage | null;
}

/**
 * Inline "≈ N credits" chip shown next to a tool's Generate button. Matches the
 * AiCreditsPanel badge styling. Read-only — purely informational.
 */
export function ToolCostBadge({
    credits,
    sufficient,
    loading,
    className,
    coverage,
}: ToolCostBadgeProps) {
    const notEnough = sufficient === false;
    if (coverage && !loading) {
        return (
            <div
                className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border border-success-200 bg-success-50 px-2.5 py-1 text-xs font-semibold text-success-700',
                    className
                )}
                title={`About ${credits ?? '…'} credits at list price. ${coverageLabel(coverage)} (${coverage.planName}).`}
            >
                <Sparkle className="size-3.5" weight="fill" />
                <span>{coverageLabel(coverage)}</span>
            </div>
        );
    }
    return (
        <div
            className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold',
                notEnough
                    ? 'border-amber-200 bg-amber-50 text-amber-700'
                    : 'border-purple-200 bg-gradient-to-r from-purple-50 to-indigo-50 text-purple-700',
                className
            )}
            title={
                notEnough
                    ? 'Estimated cost exceeds your current credit balance'
                    : 'Estimated credit cost for this action'
            }
        >
            <Sparkle className="size-3.5" weight="fill" />
            <span>≈ {loading || credits == null ? '…' : credits} credits</span>
            {notEnough && <Warning className="size-3 text-amber-600" weight="fill" />}
        </div>
    );
}
