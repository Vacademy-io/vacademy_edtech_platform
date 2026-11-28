import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { useTranslation } from 'react-i18next';
import { QuickOfflineTestDialog } from './-components/offline-test/QuickOfflineTestDialog';
import {
    AssessmentTypePicker,
    type AssessmentTypeKey,
} from './assessment-list/-components/AssessmentTypePicker';

// Route stub for TanStack Router - actual component loaded via index.lazy.tsx
export const Route = createFileRoute('/assessment/')({});

function AssessmentPage() {
    const { t } = useTranslation('assessmentIndex');
    const { setNavHeading } = useNavHeadingStore();
    const navigate = useNavigate();
    // Manual Upload Exam opens the one-screen form; it links to the full wizard.
    const [offlineOpen, setOfflineOpen] = useState(false);

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

    const handlePick = (type: AssessmentTypeKey) => {
        if (type === 'MANUAL_UPLOAD_EXAM') {
            setOfflineOpen(true);
            return;
        }
        handleRedirectRoute(type);
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
            <div className="max-w-4xl">
                <AssessmentTypePicker onPick={handlePick} />
            </div>
            <QuickOfflineTestDialog open={offlineOpen} onOpenChange={setOfflineOpen} />
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
