import type { StageAccent } from './lead-stage-chip';
import type { LeadKpiMetric } from './use-lead-kpi-counts';
import type { LeadTier } from '@/hooks/use-lead-tiers';

/**
 * LeadBoardColumnConfig — a data-driven board column. Columns are intentionally
 * config-driven (not hardcoded) so a future "lead statuses" settings screen can
 * supply custom columns without touching the board components.
 */
export interface LeadBoardColumnConfig {
    id: string;
    label: string;
    accent: StageAccent;
    /** Admin-picked hex colour (custom tiers); overrides `accent` for the header dot. */
    color?: string;
    /** Extra filter params merged into the per-column list request. */
    params: {
        lead_tier?: string;
        conversion_status_filter?: 'EXCLUDE_CONVERTED' | 'ONLY_CONVERTED' | 'ALL';
    };
    /** KPI metric whose count labels this column header (reuses the KPI fetch). */
    kpiMetric?: LeadKpiMetric;
}

/**
 * LEGACY default pipeline — hard-codes the Hot/Warm/Cold trio and is kept only as the source
 * of the Converted bucket (and for callers predating the tier catalog). Prefer
 * {@link buildBoardColumns}, which builds one column per tier the institute actually configured.
 */
export const DEFAULT_BOARD_COLUMNS: LeadBoardColumnConfig[] = [
    {
        id: 'hot',
        label: 'Hot',
        accent: 'red',
        params: { lead_tier: 'HOT', conversion_status_filter: 'EXCLUDE_CONVERTED' },
        kpiMetric: 'HOT',
    },
    {
        id: 'warm',
        label: 'Warm',
        accent: 'amber',
        params: { lead_tier: 'WARM', conversion_status_filter: 'EXCLUDE_CONVERTED' },
        kpiMetric: 'WARM',
    },
    {
        id: 'cold',
        label: 'Cold',
        accent: 'blue',
        params: { lead_tier: 'COLD', conversion_status_filter: 'EXCLUDE_CONVERTED' },
        kpiMetric: 'COLD',
    },
    {
        id: 'converted',
        label: 'Converted',
        accent: 'emerald',
        params: { conversion_status_filter: 'ONLY_CONVERTED' },
        kpiMetric: 'CONVERTED',
    },
];

/**
 * Board columns from the institute's tier catalog: one column per tier (in
 * catalog order, active leads only) plus the Converted bucket. Use instead of
 * DEFAULT_BOARD_COLUMNS once useLeadTiers() has loaded.
 */
export function buildBoardColumns(tiers: LeadTier[]): LeadBoardColumnConfig[] {
    const tierCols: LeadBoardColumnConfig[] = tiers.map((t) => ({
        id: t.tier_key.toLowerCase(),
        label: t.label,
        accent: 'neutral',
        color: t.color,
        params: { lead_tier: t.tier_key, conversion_status_filter: 'EXCLUDE_CONVERTED' },
        kpiMetric: t.tier_key,
    }));
    const converted = DEFAULT_BOARD_COLUMNS[DEFAULT_BOARD_COLUMNS.length - 1]!;
    return [...tierCols, converted];
}
