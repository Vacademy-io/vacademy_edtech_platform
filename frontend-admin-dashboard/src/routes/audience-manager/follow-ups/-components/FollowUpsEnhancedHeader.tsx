import { useTranslation } from 'react-i18next';
import { UsersThree } from '@phosphor-icons/react';
import { useCrmDashboardBlocks } from '@/routes/dashboard/-services/use-crm-blocks';
import type { CrmCounsellorRow } from '@/routes/dashboard/-services/crm-dashboard';
import { Meter } from '@/routes/dashboard/-components/crm/crm-cards';
import { SectionCard } from '@/routes/study-library/live-session/-components/dashboard/dashboard-charts';

/**
 * Follow-ups: who holds the overdue work, under the existing tiles. Only for admins and hierarchy-scoped counsellors — other roles are
 * limited to their own follow-ups on this page, and a team breakdown would show more.
 * Takes the list's lead status filter (the route's status + hide-LOST setting), and the
 * list's duplicate default (AUTO: hidden when Lead Settings keeps duplicates on the
 * Duplicate Leads tab only), so each counsellor's number equals the list filtered to them.
 */
export function FollowUpsEnhancedHeader({
    allowed,
    leadStatusId,
    leadStatusExcludeId,
}: {
    allowed: boolean;
    leadStatusId?: string;
    leadStatusExcludeId?: string;
}) {
    const enabled = allowed;
    const { t } = useTranslation('crmPages');
    const { pick } = useCrmDashboardBlocks(['counsellors'], {
        enabled,
        leadStatusId,
        leadStatusExcludeId,
        duplicateFilter: 'AUTO',
    });
    if (!enabled) return null;
    const rows = (pick<{ rows: CrmCounsellorRow[] }>('counsellors')?.rows ?? [])
        .filter((r) => r.overdue > 0)
        .sort((a, b) => b.overdue - a.overdue);
    if (rows.length < 2) return null;

    const max = Math.max(1, ...rows.map((r) => r.overdue));
    return (
        <SectionCard
            icon={UsersThree}
            title={t('followUps.byCounsellor.title')}
            subtitle={t('followUps.byCounsellor.subtitle')}
        >
            <div className="grid gap-x-8 gap-y-2 md:grid-cols-2">
                {/* Every counsellor, not a top N: the rows must add up to the Overdue tile. */}
                {rows.map((r) => (
                    <div key={r.owner_id} className="grid grid-cols-12 items-center gap-3">
                        <span className="col-span-4 truncate text-neutral-700">
                            <span className="text-caption">{r.name || '—'}</span>
                        </span>
                        <span className="col-span-7">
                            <Meter value={r.overdue} max={max} tone="danger" />
                        </span>
                        <span className="col-span-1 text-right font-semibold tabular-nums text-neutral-900">
                            <span className="text-caption">{r.overdue}</span>
                        </span>
                    </div>
                ))}
            </div>
        </SectionCard>
    );
}
