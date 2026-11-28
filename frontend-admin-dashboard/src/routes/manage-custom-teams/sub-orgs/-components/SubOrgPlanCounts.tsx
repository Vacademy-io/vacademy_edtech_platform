import { useTranslation } from 'react-i18next';
import { instituteTerms } from '@/components/shared/crm-enhance/institute-terms';
import { QuickViews, type QuickView } from '@/components/shared/crm-enhance';
import type { SubOrgListItem } from '../../-services/custom-team-services';

const TONE: Record<string, QuickView['tone']> = {
    ACTIVE: 'success',
    PENDING_PAYMENT: 'warning',
    AWAITING_ADMIN: 'warning',
    EXPIRED: 'danger',
};

/**
 * Manage Sub-Orgs: Sub-Orgs per plan status, counted from the list the table
 * already loaded (same caller-scoped rows). Each card sets the table's Status
 * filter to that one status; "All" clears it.
 */
export function SubOrgPlanCounts({
    rows,
    noPlanKey,
    selected,
    onSelect,
}: {
    rows: SubOrgListItem[];
    /** The list's facet key for rows with no plan yet. */
    noPlanKey: string;
    selected: string[];
    onSelect: (statuses: string[]) => void;
}) {
    const { t } = useTranslation('crmPages');
    const { t: tList } = useTranslation('manageCustomTeamsSubOrgList');
    if (!rows.length) return null;
    const counts = new Map<string, number>();
    rows.forEach((o) => {
        const k = o.plan_status || noPlanKey;
        counts.set(k, (counts.get(k) ?? 0) + 1);
    });
    const only = selected.length === 1 ? selected[0] : null;
    const views: QuickView[] = [
        {
            key: 'all',
            label: tList('planCounts.all'),
            count: rows.length,
            active: selected.length === 0,
            onSelect: () => onSelect([]),
        },
        ...[...counts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([k, n]) => ({
                key: k,
                label:
                    k === noPlanKey
                        ? tList('filters.noPlanOption')
                        : t(`institute.subOrgs.status.${k}`, {
                              defaultValue: k.replace(/_/g, ' ').toLowerCase(),
                          }),
                count: n,
                tone: TONE[k] ?? 'neutral',
                active: only === k,
                onSelect: () => onSelect(only === k ? [] : [k]),
            })),
    ];
    return <QuickViews views={views} caption={t('subOrgs.caption', instituteTerms())} />;
}
