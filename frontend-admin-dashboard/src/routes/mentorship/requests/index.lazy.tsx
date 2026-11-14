import { useEffect } from 'react';
import { createLazyFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { getInstituteId } from '@/constants/helper';
import { MentorRequestsPanel } from '../-components/MentorRequestsPanel';

export const Route = createLazyFileRoute('/mentorship/requests/')({
    component: MentorRequestsRoute,
});

function MentorRequestsRoute() {
    const { t } = useTranslation('mentorshipRequestsIndex');
    const { setNavHeading } = useNavHeadingStore();
    useEffect(() => {
        setNavHeading(<h1 className="text-lg">{t('navHeading')}</h1>);
    }, [setNavHeading, t]);

    return (
        <LayoutContainer>
            <MentorRequestsPanel instituteId={getInstituteId()} />
        </LayoutContainer>
    );
}
