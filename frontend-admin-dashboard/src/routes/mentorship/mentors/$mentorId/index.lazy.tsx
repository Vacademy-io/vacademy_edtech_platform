import { useEffect } from 'react';
import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { getInstituteId } from '@/constants/helper';
import { MentorDetailView, type MentorDetailTab } from '../../-components/MentorDetailView';

export const Route = createLazyFileRoute('/mentorship/mentors/$mentorId/')({
    component: MentorDetailRoute,
});

function MentorDetailRoute() {
    const { t } = useTranslation('mentorshipMentorDetailIndex');
    const { mentorId } = Route.useParams();
    const { tab = 'overview' } = Route.useSearch();
    const navigate = useNavigate();

    const { setNavHeading } = useNavHeadingStore();
    useEffect(() => {
        setNavHeading(<h1 className="text-lg">{t('navHeading')}</h1>);
    }, [setNavHeading, t]);

    return (
        <LayoutContainer>
            <MentorDetailView
                mentorId={mentorId}
                instituteId={getInstituteId()}
                tab={tab}
                // The tab lives in the URL, so a mentor's sessions stay linkable.
                onTabChange={(next: MentorDetailTab) =>
                    navigate({
                        to: '.',
                        search: next === 'overview' ? {} : { tab: next },
                        replace: true,
                    })
                }
            />
        </LayoutContainer>
    );
}
