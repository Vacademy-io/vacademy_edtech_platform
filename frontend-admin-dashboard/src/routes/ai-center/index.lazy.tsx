import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AICenterProvider } from './-contexts/useAICenterContext';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { buildAIToolCardData } from './-constants/AICardsData';
import { AIToolsCard } from './-components/AIToolsCard';
import MyResources from './-components/My-Resources-List/MyResources';
import UploadFileMyResourcesComponent from './-components/UploadFileMyResourcesComponent';

export const Route = createLazyFileRoute('/ai-center/')({
    component: () => (
        <LayoutContainer>
            <AICenterProvider>
                <RouteComponent />
            </AICenterProvider>
        </LayoutContainer>
    ),
});

const slugify = (text: string): string => {
    return text
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\w-]+/g, '');
};

function RouteComponent() {
    const { t } = useTranslation('aiCenterIndex');
    const { t: tAiCards } = useTranslation('aiCenterAICardsData');
    const [selectedTab, setSelectedTab] = useState('myResources');
    const { setNavHeading } = useNavHeadingStore();

    const AIToolCardData = buildAIToolCardData(tAiCards);

    const handleTabChange = (value: string) => {
        const element = document.getElementById(value);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };

    // Corrected line to avoid TS2532 error (already correct)
    const firstCategoryTitle = AIToolCardData[0]?.title;
    const defaultTabValue = firstCategoryTitle ? slugify(firstCategoryTitle) : '';

    const navBarHeightClass = 'top-16';
    const sectionScrollMarginTopClass = 'scroll-mt-32';

    useEffect(() => {
        setNavHeading(t('navHeading'));
    }, [setNavHeading, t]);

    return (
        <>
            <Tabs value={selectedTab} onValueChange={setSelectedTab}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <TabsList className="no-scrollbar mb-2 inline-flex h-auto w-full justify-start gap-2 overflow-x-auto rounded-none border-b !bg-transparent p-0 sm:w-auto sm:gap-4">
                        <TabsTrigger
                            value="myResources"
                            className={`flex shrink-0 gap-1.5 rounded-none px-4 py-2 text-sm !shadow-none sm:px-12 ${selectedTab === 'myResources'
                                ? 'border-4px rounded-t-sm border !border-b-0 border-primary-200 !bg-primary-50'
                                : 'border-none bg-transparent'
                                }`}
                        >
                            <span
                                className={`${selectedTab === 'myResources' ? 'text-primary-500' : ''}`}
                            >
                                {t('tabMyResources')}
                            </span>
                        </TabsTrigger>
                        <TabsTrigger
                            value="aiTaskList"
                            className={`inline-flex shrink-0 gap-1.5 rounded-none px-4 py-2 text-sm !shadow-none sm:px-12 ${selectedTab === 'aiTaskList'
                                ? 'rounded-t-sm border !border-b-0 border-primary-200 !bg-primary-50'
                                : 'border-none bg-transparent'
                                }`}
                        >
                            <span
                                className={`${selectedTab === 'aiTaskList' ? 'text-primary-500' : ''}`}
                            >
                                {t('tabAiTools')}
                            </span>
                        </TabsTrigger>
                    </TabsList>
                    <div className="w-full sm:w-auto">
                        <UploadFileMyResourcesComponent />
                    </div>
                </div>
                <TabsContent value="myResources">
                    <MyResources />
                </TabsContent>
                <TabsContent value="aiTaskList">
                    <Tabs
                        defaultValue={defaultTabValue}
                        onValueChange={handleTabChange}
                        className="flex w-full flex-col items-start gap-4"
                    >
                        <TabsList
                            className={`no-scrollbar sticky ${navBarHeightClass} z-40 mb-4 flex w-full gap-1 self-start overflow-x-auto rounded-lg bg-white p-1.5 shadow-sm sm:inline-flex sm:w-auto`}
                        >
                            {AIToolCardData.map((category) => (
                                <TabsTrigger
                                    key={slugify(category.title)}
                                    value={slugify(category.title)}
                                    className="h-9 w-auto shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium hover:cursor-pointer data-[state=active]:bg-primary-50 data-[state=active]:text-primary-500 sm:h-10 sm:w-52 sm:text-sm"
                                >
                                    {category.title}
                                </TabsTrigger>
                            ))}
                        </TabsList>

                        <div className="flex w-full flex-col gap-4">
                            {AIToolCardData.map((category) => (
                                <section
                                    key={slugify(category.title)}
                                    id={slugify(category.title)}
                                    className={`flex w-full flex-col gap-4 sm:gap-6 ${sectionScrollMarginTopClass}`}
                                >
                                    <h2 className="border-b pb-2 text-lg font-semibold text-gray-800 sm:pb-3 sm:text-2xl">
                                        {category.title}
                                    </h2>
                                    <div className="flex w-full flex-col gap-4 sm:gap-6">
                                        {category.features.map((feature) => (
                                            <AIToolsCard key={feature.key} feature={feature} />
                                        ))}
                                    </div>
                                </section>
                            ))}
                        </div>
                    </Tabs>
                </TabsContent>
            </Tabs>
        </>
    );
}
