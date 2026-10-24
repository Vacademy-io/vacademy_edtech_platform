import { createLazyFileRoute } from '@tanstack/react-router';
import GenerateAIAssessmentComponent from './-components/GenerateAssessment';
import { AICenterProvider } from '@/routes/ai-center/-contexts/useAICenterContext';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { CaretLeft } from '@phosphor-icons/react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';

export const Route = createLazyFileRoute('/ai-center/ai-tools/vsmart-upload/')({
    component: RouteComponent,
});

function RouteComponent() {
    const { t } = useTranslation('aiCenterVsmartUploadIndex');
    const { setNavHeading } = useNavHeadingStore();
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
                <GenerateAIAssessmentComponent />
            </AICenterProvider>
        </LayoutContainer>
    );
}
