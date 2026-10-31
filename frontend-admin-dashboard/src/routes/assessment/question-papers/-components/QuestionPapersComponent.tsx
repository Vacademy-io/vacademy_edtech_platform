import { Helmet } from 'react-helmet';
import { QuestionPapersPageHeader } from './QuestionPapersPageHeader';
import { AddQuestionPaperFlow } from './AddQuestionPaperFlow';
import { QuestionPapersTabs } from './QuestionPapersTabs';
import { useEffect, useState } from 'react';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useTranslation } from 'react-i18next';

export function QuestionPapersComponent() {
    const { t } = useTranslation('assessmentQuestionPapersComponent');
    const { setNavHeading } = useNavHeadingStore();
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);

    useEffect(() => {
        setNavHeading(<h1 className="text-lg">{t('heading')}</h1>);
    }, []);

    return (
        <>
            <Helmet>
                <title>{t('pageTitle')}</title>
                <meta name="description" content={t('pageDescription')} />
            </Helmet>
            <div className="flex flex-col gap-6">
                <QuestionPapersPageHeader />
                <QuestionPapersTabs
                    isAssessment={false}
                    currentQuestionIndex={currentQuestionIndex}
                    setCurrentQuestionIndex={setCurrentQuestionIndex}
                />
            </div>
            <AddQuestionPaperFlow
                currentQuestionIndex={currentQuestionIndex}
                setCurrentQuestionIndex={setCurrentQuestionIndex}
            />
        </>
    );
}
