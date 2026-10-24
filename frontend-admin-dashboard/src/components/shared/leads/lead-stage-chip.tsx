import { cn } from '@/lib/utils';
import { tierChipStyle, useLeadTiers, type LeadTierCatalog } from '@/hooks/use-lead-tiers';

/**
 * LeadStageChip — the Orbitra-style "Lead Stage" soft pill.
 *
 * Stage is derived from the lead's tier (HOT / WARM / COLD) unless the lead has
 * already converted, in which case it shows a "Converted" success chip (matching
 * the table rule that suppresses the tier badge for converted leads). When no
 * tier is known yet, it falls back to a neutral "New" pill.
 */

export type StageAccent = 'red' | 'amber' | 'blue' | 'emerald' | 'neutral';

const ACCENT_STYLES: Record<StageAccent, string> = {
    red: 'bg-red-100 text-red-700',
    amber: 'bg-amber-100 text-amber-700',
    blue: 'bg-blue-100 text-blue-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    neutral: 'bg-neutral-100 text-neutral-600',
};

const TIER_TO_STAGE: Record<string, { label: string; accent: StageAccent }> = {
    HOT: { label: 'Hot', accent: 'red' },
    WARM: { label: 'Warm', accent: 'amber' },
    COLD: { label: 'Cold', accent: 'blue' },
};

interface LeadStageChipProps {
    tier?: string | null;
    conversionStatus?: string | null;
    className?: string;
}

/**
 * Resolve the stage pill for a lead. With a catalog, any known tier key maps to
 * its configured label + hex colour (returned as `color`, accent 'neutral');
 * without one the legacy HOT/WARM/COLD accents apply.
 */
export function resolveStage(
    tier?: string | null,
    conversionStatus?: string | null,
    catalog?: Pick<LeadTierCatalog, 'byKey'>
): { label: string; accent: StageAccent; color?: string } {
    if ((conversionStatus ?? '').toUpperCase() === 'CONVERTED') {
        return { label: 'Converted', accent: 'emerald' };
    }
    const key = (tier ?? '').toUpperCase();
    const row = catalog?.byKey(key);
    if (row) return { label: row.label, accent: 'neutral', color: row.color || undefined };
    return TIER_TO_STAGE[key] ?? { label: 'New', accent: 'neutral' };
}

export function LeadStageChip({ tier, conversionStatus, className }: LeadStageChipProps) {
    const catalog = useLeadTiers();
    const { label, accent, color } = resolveStage(tier, conversionStatus, catalog);
    return (
        <span
            className={cn(
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                color ? 'border' : ACCENT_STYLES[accent],
                className
            )}
            // Inline style: tier colour is admin-picked hex with no design-token equivalent.
            style={color ? tierChipStyle(color) : undefined}
        >
            {label}
        </span>
    );
}
