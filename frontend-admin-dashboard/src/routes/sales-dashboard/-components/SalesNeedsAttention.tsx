import { Skeleton } from '@/components/ui/skeleton';
import { useCrmDashboardBlocks } from '@/routes/dashboard/-services/use-crm-blocks';
import type {
    CrmCounsellorRow,
    CrmFollowupsBlock,
    CrmListRow,
    CrmSummaryBlock,
} from '@/routes/dashboard/-services/crm-dashboard';
import { AttentionCard } from '@/routes/dashboard/-components/crm/crm-cards';
import { useAttentionItems } from '@/routes/dashboard/-components/crm/attention-items';

/**
 * Sales Dashboard: the "Needs attention" list from the CRM Dashboard, for
 * the picked team (always inside the caller's own lead scope).
 */
export function SalesNeedsAttention({ teamId }: { teamId?: string }) {
    const { pick, isLoading, window } = useCrmDashboardBlocks(
        ['followups', 'counsellors', 'summary', 'lists'],
        { teamId }
    );
    const items = useAttentionItems({
        followups: pick<CrmFollowupsBlock>('followups'),
        counsellors: pick<{ rows: CrmCounsellorRow[] }>('counsellors')?.rows,
        summary: pick<CrmSummaryBlock>('summary'),
        lists: pick<CrmListRow[]>('lists'),
        window,
    });
    if (isLoading) return <Skeleton className="h-48 rounded-xl" />;
    return <AttentionCard items={items} />;
}
