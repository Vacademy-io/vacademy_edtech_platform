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
    const { t } = useTranslation('evaluationScheduleTestTabList');
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
                    {t('live')}
                </span>
                <Badge
                    className="rounded-[10px] bg-primary-500 p-0 px-2 text-[9px] text-white"
                    variant="outline"
                >
                    {scheduleTestTabsData[0]?.data?.content &&
                    scheduleTestTabsData[0]?.data?.content.length > 0
                        ? scheduleTestTabsData[0]?.data?.total_elements
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
                    {t('previous')}
                </span>
                <Badge
                    className="rounded-[10px] bg-primary-500 p-0 px-2 text-[9px] text-white"
                    variant="outline"
                >
                    {scheduleTestTabsData[2]?.data?.content?.length
                        ? scheduleTestTabsData[2]?.data?.total_elements ?? 0
                        : 0}
                </Badge>
            </TabsTrigger>
        </TabsList>
    );
};

export default ScheduleTestTabList;
