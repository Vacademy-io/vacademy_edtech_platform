import { createLazyFileRoute } from '@tanstack/react-router';
import PDFEvaluator from './-components/pdf-editor';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { Helmet } from 'react-helmet';
import { useEffect } from 'react';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useTranslation } from 'react-i18next';

export const Route = createLazyFileRoute('/evaluation/evaluation-tool/')({
    component: RouteComponent,
});

function RouteComponent() {
    const { t } = useTranslation('evaluationToolIndex');
    const { setNavHeading } = useNavHeadingStore();
    useEffect(() => {
        setNavHeading(<h1 className="text-lg">{t('navHeading')}</h1>);
    }, []);
    return (
        <LayoutContainer>
            <Helmet>
                <title>{t('pageTitle')}</title>
                <meta name="description" content={t('pageDescription')} />
            </Helmet>
            <PDFEvaluator isFreeTool />
        </LayoutContainer>
    );
}
