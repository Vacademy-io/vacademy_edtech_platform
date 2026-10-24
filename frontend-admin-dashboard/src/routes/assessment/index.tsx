import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { Examination, Mock, Practice, Survey } from '@/svgs';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { useTranslation } from 'react-i18next';

// Route stub for TanStack Router - actual component loaded via index.lazy.tsx
export const Route = createFileRoute('/assessment/')({});

function AssessmentPage() {
    const { t } = useTranslation('assessmentIndex');
    const { setNavHeading } = useNavHeadingStore();
    const navigate = useNavigate();

    const handleRedirectRoute = (type: string) => {
        navigate({
            to: '/assessment/create-assessment/$assessmentId/$examtype',
            params: {
                assessmentId: 'defaultId',
                examtype: type,
            },
            search: {
                currentStep: 0,
            },
        });
    };

    useEffect(() => {
        setNavHeading(<h1 className="text-lg">{t('pageHeading')}</h1>);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
        <>
            <Helmet>
                <title>{t('pageHeading')}</title>
                <meta name="description" content={t('metaDescription')} />
            </Helmet>
            <div className="pb-4 text-lg font-semibold sm:pb-6 sm:text-title">
                {t('createAssessmentHeading')}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2 lg:gap-8">
                <div
                    onClick={() => handleRedirectRoute('EXAM')}
                    className="flex cursor-pointer flex-col items-center rounded-xl border bg-neutral-50 p-4 transition-all hover:border-primary-200 hover:shadow-md active:scale-[0.98] sm:p-6 md:p-8"
                >
                    <Examination className="size-16 sm:size-auto" />
                    <h1 className="mt-2 text-lg font-semibold sm:text-h2">
                        {t('cards.examination.title')}
                    </h1>
                    <p className="mt-1 text-center text-xs text-neutral-500 sm:text-sm">
                        {t('cards.examination.description')}
                    </p>
                </div>
                <div
                    onClick={() => handleRedirectRoute('MOCK')}
                    className="flex cursor-pointer flex-col items-center rounded-xl border bg-neutral-50 p-4 transition-all hover:border-primary-200 hover:shadow-md active:scale-[0.98] sm:p-6 md:p-8"
                >
                    <Mock className="size-16 sm:size-auto" />
                    <h1 className="mt-2 text-lg font-semibold sm:text-h2">
                        {t('cards.mock.title')}
                    </h1>
                    <p className="mt-1 text-center text-xs text-neutral-500 sm:text-sm">
                        {t('cards.mock.description')}
                    </p>
                </div>
                <div
                    onClick={() => handleRedirectRoute('PRACTICE')}
                    className="flex cursor-pointer flex-col items-center rounded-xl border bg-neutral-50 p-4 transition-all hover:border-primary-200 hover:shadow-md active:scale-[0.98] sm:p-6 md:p-8"
                >
                    <Practice className="size-16 sm:size-auto" />
                    <h1 className="mt-2 text-lg font-semibold sm:text-h2">
                        {t('cards.practice.title')}
                    </h1>
                    <p className="mt-1 text-center text-xs text-neutral-500 sm:text-sm">
                        {t('cards.practice.description')}
                    </p>
                </div>
                <div
                    onClick={() => handleRedirectRoute('SURVEY')}
                    className="flex cursor-pointer flex-col items-center rounded-xl border bg-neutral-50 p-4 transition-all hover:border-primary-200 hover:shadow-md active:scale-[0.98] sm:p-6 md:p-8"
                >
                    <Survey className="size-16 sm:size-auto" />
                    <h1 className="mt-2 text-lg font-semibold sm:text-h2">
                        {t('cards.survey.title')}
                    </h1>
                    <p className="mt-1 text-center text-xs text-neutral-500 sm:text-sm">
                        {t('cards.survey.description')}
                    </p>
                </div>
                <div
                    onClick={() => handleRedirectRoute('MANUAL_UPLOAD_EXAM')}
                    className="flex cursor-pointer flex-col items-center rounded-xl border bg-neutral-50 p-4 transition-all hover:border-primary-200 hover:shadow-md active:scale-[0.98] sm:p-6 md:p-8"
                >
                    <Examination className="size-16 sm:size-auto" />
                    <h1 className="mt-2 text-lg font-semibold sm:text-h2">
                        {t('cards.manualUploadExam.title')}
                    </h1>
                    <p className="mt-1 text-center text-xs text-neutral-500 sm:text-sm">
                        {t('cards.manualUploadExam.description')}
                    </p>
                </div>
            </div>
        </>
    );
}

export default function AssessmentRouteComponent() {
    return (
        <LayoutContainer>
            <AssessmentPage />
        </LayoutContainer>
    );
}
