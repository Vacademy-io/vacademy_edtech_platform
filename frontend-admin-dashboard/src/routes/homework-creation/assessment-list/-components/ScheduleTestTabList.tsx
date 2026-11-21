import { Badge } from '@/components/ui/badge';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScheduleTestTab } from '@/types/assessments/assessment-list';
import { useTranslation } from 'react-i18next';

const ScheduleTestTabList = ({
    selectedTab,
    scheduleTestTabsData,
}: {
    selectedTab: string;
    scheduleTestTabsData: ScheduleTestTab[];
}) => {
    const { t } = useTranslation('homeworkCreationScheduleTestTabList');
    return (
        <TabsList className="inline-flex h-auto justify-start gap-4 rounded-none border-b !bg-transparent p-0">
            <TabsTrigger
                value="liveTests"
                className={`flex gap-1.5 rounded-none px-12 py-2 !shadow-none ${
                    selectedTab === 'liveTests'
                        ? 'rounded-t-sm border !border-b-0 border-primary-200 !bg-primary-50'
                        : 'border-none bg-transparent'
                }`}
            >
                <span className={`${selectedTab === 'liveTests' ? 'text-primary-500' : ''}`}>
                    {t('tabs.live')}
                </span>
                <Badge
                    className="rounded-lg bg-primary-500 p-0 px-2 text-2xs text-white"
                    variant="outline"
                >
                    {scheduleTestTabsData[0]?.data?.content &&
                    scheduleTestTabsData[0]?.data?.content.length > 0
                        ? scheduleTestTabsData[0]?.data?.total_elements
                        : 0}
                </Badge>
            </TabsTrigger>
            <TabsTrigger
                value="upcomingTests"
                className={`flex gap-1.5 rounded-none px-12 py-2 !shadow-none ${
                    selectedTab === 'upcomingTests'
                        ? 'rounded-t-sm border !border-b-0 border-primary-200 !bg-primary-50'
                        : 'border-none bg-transparent'
                }`}
            >
                <span className={`${selectedTab === 'upcomingTests' ? 'text-primary-500' : ''}`}>
                    {t('tabs.upcoming')}
                </span>
                <Badge
                    className="rounded-lg bg-primary-500 p-0 px-2 text-2xs text-white"
                    variant="outline"
                >
                    {scheduleTestTabsData[1]?.data?.content?.length
                        ? scheduleTestTabsData[1]?.data?.total_elements ?? 0
                        : 0}
                </Badge>
            </TabsTrigger>
            <TabsTrigger
                value="previousTests"
                className={`flex gap-1.5 rounded-none px-12 py-2 !shadow-none ${
                    selectedTab === 'previousTests'
                        ? 'rounded-t-sm border !border-b-0 border-primary-200 !bg-primary-50'
                        : 'border-none bg-transparent'
                }`}
            >
                <span className={`${selectedTab === 'previousTests' ? 'text-primary-500' : ''}`}>
                    {t('tabs.previous')}
                </span>
                <Badge
                    className="rounded-lg bg-primary-500 p-0 px-2 text-2xs text-white"
                    variant="outline"
                >
                    {scheduleTestTabsData[2]?.data?.content?.length
                        ? scheduleTestTabsData[2]?.data?.total_elements ?? 0
                        : 0}
                </Badge>
            </TabsTrigger>
            <TabsTrigger
                value="draftTests"
                className={`flex gap-1.5 rounded-none px-12 py-2 !shadow-none ${
                    selectedTab === 'draftTests'
                        ? 'rounded-t-sm border !border-b-0 border-primary-200 !bg-primary-50'
                        : 'border-none bg-transparent'
                }`}
            >
                <span className={`${selectedTab === 'draftTests' ? 'text-primary-500' : ''}`}>
                    {t('tabs.drafts')}
                </span>
                <Badge
                    className="rounded-lg bg-primary-500 p-0 px-2 text-2xs text-white"
                    variant="outline"
                >
                    {scheduleTestTabsData[3]?.data?.content?.length
                        ? scheduleTestTabsData[3]?.data?.total_elements ?? 0
                        : 0}
                </Badge>
            </TabsTrigger>
        </TabsList>
    );
};

export default ScheduleTestTabList;
