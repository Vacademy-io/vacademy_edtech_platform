import { useEffect, useState } from 'react';
import { createLazyFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { CalendarPlus, Handshake } from '@phosphor-icons/react';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { MyButton } from '@/components/design-system/button';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { getInstituteId } from '@/constants/helper';
import { instituteTerms } from '@/components/shared/crm-enhance/institute-terms';
import { MentorshipDashboard } from '../-components/MentorshipDashboard';
import { MentorshipPageHeader } from '../-components/MentorshipPageHeader';
import { ScheduleSessionDialog } from '../-components/ScheduleSessionDialog';

export const Route = createLazyFileRoute('/mentorship/dashboard/')({
    component: MentorshipDashboardRoute,
});

function MentorshipDashboardRoute() {
    const { t } = useTranslation('mentorshipDashboardIndex');
    const { setNavHeading } = useNavHeadingStore();
    useEffect(() => {
        setNavHeading(<h1 className="text-lg">{t('navHeading')}</h1>);
    }, [setNavHeading, t]);

    const instituteId = getInstituteId();
    const [scheduleOpen, setScheduleOpen] = useState(false);

    return (
        <LayoutContainer>
            <div className="flex flex-col gap-6 p-6">
                <MentorshipPageHeader title={t('title')} subtitle={t('subtitle')} icon={Handshake}>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        onClick={() => setScheduleOpen(true)}
                        title={t('scheduleButtonTitle', {
                            learner: instituteTerms().learner.toLowerCase(),
                        })}
                    >
                        <CalendarPlus size={18} /> {t('scheduleButtonLabel')}
                    </MyButton>
                </MentorshipPageHeader>
                <MentorshipDashboard instituteId={instituteId} />

                {/* Same dialog as the Sessions page; its mentor list is the dashboard
                    request this page already made, so opening it adds no fetch. */}
                <ScheduleSessionDialog
                    instituteId={instituteId}
                    open={scheduleOpen}
                    onOpenChange={setScheduleOpen}
                />
            </div>
        </LayoutContainer>
    );
}
