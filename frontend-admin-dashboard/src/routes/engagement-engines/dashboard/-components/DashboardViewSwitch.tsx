import { useTranslation } from 'react-i18next';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { DashboardView } from '../-utils/dashboard-search';

export type { DashboardView };

const VIEWS: DashboardView[] = ['daily', 'weekly', 'overview'];

/**
 * Daily | Weekly | Overview switch in the Engagement Dashboard header. The choice lives in the
 * URL (?view=weekly or ?view=overview; no param = the daily report), so any view can be shared.
 */
export function DashboardViewSwitch({
    value,
    onChange,
}: {
    value: DashboardView;
    onChange: (view: DashboardView) => void;
}) {
    const { t } = useTranslation('engagementDailyReport');
    return (
        <Tabs
            value={value}
            onValueChange={(next) => onChange(VIEWS.find((v) => v === next) ?? 'daily')}
        >
            <TabsList aria-label={t('viewSwitch.label')}>
                {VIEWS.map((view) => (
                    <TabsTrigger key={view} value={view}>
                        <span className="text-caption">{t(`viewSwitch.${view}`)}</span>
                    </TabsTrigger>
                ))}
            </TabsList>
        </Tabs>
    );
}
