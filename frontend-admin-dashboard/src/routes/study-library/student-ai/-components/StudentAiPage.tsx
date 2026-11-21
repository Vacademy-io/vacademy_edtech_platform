import { useEffect } from 'react';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { ChartLineUp, Gear } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { StudentAiSettingsSection } from '@/routes/settings/-components/StudentAiSettingsSection';
import { ChatbotAnalysis } from './ChatbotAnalysis';

type StudentAiTab = 'settings' | 'analysis';

const routeApi = getRouteApi('/study-library/student-ai/');

/**
 * LMS → Student AI. Two sub-tabs: the learner-chatbot configuration (the same
 * form as Settings → AI → Student AI, so there is one source of truth) and a
 * read-only analysis of what students actually do with it.
 */
export const StudentAiPage = () => {
    const { setNavHeading } = useNavHeadingStore();
    const { tab } = routeApi.useSearch();
    const navigate = useNavigate();
    const { t } = useTranslation('studyLibraryStudentAiPage');

    useEffect(() => {
        setNavHeading(t('studentAi'));
    }, [setNavHeading, t]);

    return (
        <Tabs
            value={tab}
            onValueChange={(value) =>
                // Keep the active sub-tab in the URL so it survives refresh/back.
                navigate({
                    to: '/study-library/student-ai',
                    search: { tab: value as StudentAiTab },
                    replace: true,
                })
            }
            className="flex flex-col gap-6"
        >
            <TabsList className="w-fit">
                <TabsTrigger value="settings" className="gap-1.5">
                    <Gear className="size-4" />
                    {t('studentAiSettings')}
                </TabsTrigger>
                <TabsTrigger value="analysis" className="gap-1.5">
                    <ChartLineUp className="size-4" />
                    {t('chatbotAnalysis')}
                </TabsTrigger>
            </TabsList>

            <TabsContent value="settings" className="mt-0">
                <StudentAiSettingsSection />
            </TabsContent>
            <TabsContent value="analysis" className="mt-0">
                <ChatbotAnalysis />
            </TabsContent>
        </Tabs>
    );
};

export default StudentAiPage;
