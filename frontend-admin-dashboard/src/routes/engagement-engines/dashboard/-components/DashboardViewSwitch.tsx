import { useTranslation } from 'react-i18next';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export type DashboardView = 'daily' | 'overview';

/**
 * Daily report | Overview switch in the Engagement Dashboard header. The choice lives in the
 * URL (?view=overview; no param = the daily report), so either view can be shared.
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
            onValueChange={(next) => onChange(next === 'overview' ? 'overview' : 'daily')}
        >
            <TabsList aria-label={t('viewSwitch.label')}>
                <TabsTrigger value="daily">
                    <span className="text-caption">{t('viewSwitch.daily')}</span>
                </TabsTrigger>
                <TabsTrigger value="overview">
                    <span className="text-caption">{t('viewSwitch.overview')}</span>
                </TabsTrigger>
            </TabsList>
        </Tabs>
    );
}
