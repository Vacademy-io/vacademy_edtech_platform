import { CalendarCheck, ClockCounterClockwise, NotePencil } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScheduleTestTab } from '@/types/assessments/assessment-list';
import { useTranslation } from 'react-i18next';

const ScheduleTestTabList = ({
    selectedTab,
    scheduleTestTabsData,
    tabCounts,
}: {
    selectedTab: string;
    scheduleTestTabsData: ScheduleTestTab[];
    // Real per-tab counts, populated up front (independent of which tab is open).
    // null = not fetched yet; fall back to the loaded list's total when present.
    tabCounts?: Record<string, number | null>;
}) => {
    const { t } = useTranslation('assessmentScheduleTestTabList');
    // Prefer the independently-fetched count; fall back to the tab's loaded list
    // total, then 0. Keeps badges correct before a tab is ever opened.
    const countFor = (tabValue: string, tabData: ScheduleTestTab | undefined) => {
        const c = tabCounts?.[tabValue];
        if (c !== null && c !== undefined) return c;
        return tabData?.data?.content?.length ? tabData?.data?.total_elements ?? 0 : 0;
    };

    // Same tab icons as the live session list. The Live dot is red and pulsing
    // while any test is live, and also while you are on the Live tab.
    const liveDotActive =
        countFor('liveTests', scheduleTestTabsData[0]) > 0 || selectedTab === 'liveTests';
    const liveDot = (
        <span className="relative flex size-2 self-center">
            {liveDotActive ? (
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-danger-400 opacity-75" />
            ) : null}
            <span
                className={cn(
                    'relative inline-flex size-2 rounded-full',
                    liveDotActive ? 'bg-danger-500' : 'bg-neutral-300'
                )}
            />
        </span>
    );

    // The tab strip scrolls instead of overflowing: four tabs at the desktop px-12 are far
    // wider than a phone, which cut "Previous" and "Drafts" off the screen entirely.
    return (
        <TabsList className="no-scrollbar flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-b !bg-transparent p-0 sm:gap-4">
            <TabsTrigger
                value="liveTests"
                className={`flex shrink-0 gap-1.5 whitespace-nowrap rounded-none px-4 py-2 !shadow-none sm:px-8 lg:px-12 ${
                    selectedTab === 'liveTests'
                        ? 'rounded-t-sm border !border-b-0 border-primary-200 !bg-primary-50'
                        : 'border-none bg-transparent'
                }`}
            >
                {liveDot}
                <span className={`${selectedTab === 'liveTests' ? 'text-primary-500' : ''}`}>
                    {t('tabs.live')}
                </span>
                <Badge
                    className="rounded-full bg-primary-500 p-0 px-2 text-caption text-white"
                    variant="outline"
                >
                    {countFor('liveTests', scheduleTestTabsData[0])}
                </Badge>
            </TabsTrigger>
            <TabsTrigger
                value="upcomingTests"
                className={`flex shrink-0 gap-1.5 whitespace-nowrap rounded-none px-4 py-2 !shadow-none sm:px-8 lg:px-12 ${
                    selectedTab === 'upcomingTests'
                        ? 'rounded-t-sm border !border-b-0 border-primary-200 !bg-primary-50'
                        : 'border-none bg-transparent'
                }`}
            >
                <CalendarCheck size={16} weight="duotone" className="self-center" />
                <span className={`${selectedTab === 'upcomingTests' ? 'text-primary-500' : ''}`}>
                    {t('tabs.upcoming')}
                </span>
                <Badge
                    className="rounded-full bg-primary-500 p-0 px-2 text-caption text-white"
                    variant="outline"
                >
                    {countFor('upcomingTests', scheduleTestTabsData[1])}
                </Badge>
            </TabsTrigger>
            <TabsTrigger
                value="previousTests"
                className={`flex shrink-0 gap-1.5 whitespace-nowrap rounded-none px-4 py-2 !shadow-none sm:px-8 lg:px-12 ${
                    selectedTab === 'previousTests'
                        ? 'rounded-t-sm border !border-b-0 border-primary-200 !bg-primary-50'
                        : 'border-none bg-transparent'
                }`}
            >
                <ClockCounterClockwise size={16} weight="duotone" className="self-center" />
                <span className={`${selectedTab === 'previousTests' ? 'text-primary-500' : ''}`}>
                    {t('tabs.previous')}
                </span>
                <Badge
                    className="rounded-full bg-primary-500 p-0 px-2 text-caption text-white"
                    variant="outline"
                >
                    {countFor('previousTests', scheduleTestTabsData[2])}
                </Badge>
            </TabsTrigger>
            <TabsTrigger
                value="draftTests"
                className={`flex shrink-0 gap-1.5 whitespace-nowrap rounded-none px-4 py-2 !shadow-none sm:px-8 lg:px-12 ${
                    selectedTab === 'draftTests'
                        ? 'rounded-t-sm border !border-b-0 border-primary-200 !bg-primary-50'
                        : 'border-none bg-transparent'
                }`}
            >
                <NotePencil size={16} weight="duotone" className="self-center" />
                <span className={`${selectedTab === 'draftTests' ? 'text-primary-500' : ''}`}>
                    {t('tabs.drafts')}
                </span>
                <Badge
                    className="rounded-full bg-primary-500 p-0 px-2 text-caption text-white"
                    variant="outline"
                >
                    {countFor('draftTests', scheduleTestTabsData[3])}
                </Badge>
            </TabsTrigger>
        </TabsList>
    );
};

export default ScheduleTestTabList;
