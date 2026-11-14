import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/skeleton';
import { useCrmDashboardBlocks } from '@/routes/dashboard/-services/use-crm-blocks';
import type { CrmSummaryBlock } from '@/routes/dashboard/-services/crm-dashboard';
import { CrmHero } from '@/routes/dashboard/-components/crm/crm-cards';
import { formatMinutes } from '@/routes/dashboard/-utils/crm-dashboard';

/**
 * Sales Dashboard: the leads → conversions trend for the last 30 days at the
 * top (your leads, the same scope as the leads list), with the previous 30 days dashed.
 */
export function SalesEnhancedHero({ teamId }: { teamId?: string }) {
    const { t } = useTranslation('crmPages');
    const { pick, isLoading, window } = useCrmDashboardBlocks(['summary'], { teamId });
    const summary = pick<CrmSummaryBlock>('summary');
    if (!summary) return isLoading ? <Skeleton className="h-52 rounded-xl" /> : null;
    return (
        <CrmHero
            summary={summary}
            window={window}
            rangeDays={30}
            rangeControl={null}
            showContacted
            actions={
                <span className="text-neutral-600">
                    <span className="text-caption">
                        {t('sales.heroNote', {
                            response: formatMinutes(summary.median_first_response_minutes),
                        })}
                    </span>
                </span>
            }
        />
    );
}
