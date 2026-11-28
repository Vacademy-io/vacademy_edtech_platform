import { cn } from '@/lib/utils';
import { tierChipStyle, useLeadTiers } from '@/hooks/use-lead-tiers';

/** Tier key — one of the institute's lead_tier catalog keys (HOT/WARM/COLD by default). */
export type LeadTier = string;

interface LeadScoreBadgeProps {
    score: number | null | undefined;
    /**
     * Explicit tier from the backend (UserLeadProfile.lead_tier).
     * When present it wins over the score-derived tier — this is how manual
     * admin overrides surface in the UI. When null/undefined, the tier is
     * inferred from `score` using the institute's tier bands (Hot ≥80 /
     * Warm ≥50 / Cold by default).
     */
    tier?: LeadTier | string | null | undefined;
    /** Show raw score number next to tier label. Default: true */
    showScore?: boolean;
    /** 'sm' for table cells, 'md' for sidebar cards */
    size?: 'sm' | 'md';
    className?: string;
}

export function LeadScoreBadge({
    score,
    tier,
    showScore = true,
    size = 'sm',
    className,
}: LeadScoreBadgeProps) {
    const catalog = useLeadTiers();
    const resolvedKey = catalog.resolve(tier, score);
    if (resolvedKey == null) return null;
    const isSmall = size === 'sm';
    const color = catalog.colorFor(resolvedKey);
    const label = catalog.labelFor(resolvedKey);
    const withScore = showScore && score != null;

    // One line always: institute tier labels can be long ("May Be Interested (Warm)"), so the
    // label truncates inside a narrow cell (full text on hover) while the score never wraps.
    return (
        <span
            className={cn(
                'inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border font-medium',
                isSmall ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm',
                className
            )}
            // Inline style: tier colour is admin-picked hex with no design-token equivalent.
            style={tierChipStyle(color)}
            title={withScore ? `${label} · ${score}` : label}
        >
            {/* Dot + score divider take the same admin-picked tier hex, hence inline styles. */}
            <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: color }}
            />
            <span className="min-w-0 truncate">{label}</span>
            {withScore && (
                <span
                    className="shrink-0 border-l pl-1.5 tabular-nums opacity-80"
                    style={{ borderColor: `${color}55` }}
                >
                    {score}
                </span>
            )}
        </span>
    );
}
