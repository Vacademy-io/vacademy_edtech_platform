import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { AICenterProvider } from '../../-contexts/useAICenterContext';
import EvaluateLectureAI from './-components/EvaluateLectureAI';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { CaretLeft } from '@phosphor-icons/react';

export const Route = createLazyFileRoute('/ai-center/ai-tools/vsmart-feedback/')({
    component: RouteComponent,
});

function RouteComponent() {
    const { t } = useTranslation('aiCenterVsmartFeedbackIndex');
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
                <EvaluateLectureAI />
            </AICenterProvider>
        </LayoutContainer>
    );
}
