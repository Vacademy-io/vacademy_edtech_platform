import { createLazyFileRoute, useSearch } from '@tanstack/react-router';
import { GenerateQuestionsFromText } from './-components/GenerateQuestionsFromText';
import { AICenterProvider } from '@/routes/ai-center/-contexts/useAICenterContext';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { CaretLeft } from '@phosphor-icons/react';

export const Route = createLazyFileRoute('/ai-center/ai-tools/vsmart-prompt/')({
    component: RouteComponent,
});

function RouteComponent() {
    const { t } = useTranslation('aiCenterVsmartPromptIndex');
    const { setNavHeading } = useNavHeadingStore();
    const search = useSearch({ strict: false }) as { topic?: string };
    const initialTopic = typeof search?.topic === 'string' ? search.topic : '';

    useEffect(() => {
        const heading = (
            <div className="flex items-center gap-4">
                <CaretLeft onClick={() => window.history.back()} className="cursor-pointer" />
                <div>{t('navHeading')}</div>
            </div>
        );

        setNavHeading(heading);
    }, [t]);

    return (
        <LayoutContainer>
            <AICenterProvider>
                <GenerateQuestionsFromText initialTopic={initialTopic} />
            </AICenterProvider>
        </LayoutContainer>
    );
}
