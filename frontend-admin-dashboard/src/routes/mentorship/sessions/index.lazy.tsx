import { useEffect, useState } from 'react';
import { SessionStatsCounts } from './-components/SessionStatsCounts';
import { createLazyFileRoute } from '@tanstack/react-router';
import { CalendarDots, CalendarPlus } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { MyButton } from '@/components/design-system/button';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { getInstituteId } from '@/constants/helper';
import { MentorSessionsPanel } from '../-components/MentorSessionsPanel';
import { MentorshipPageHeader } from '../-components/MentorshipPageHeader';
import { ScheduleSessionDialog } from '../-components/ScheduleSessionDialog';

export const Route = createLazyFileRoute('/mentorship/sessions/')({
    component: MentorSessionsRoute,
});

function MentorSessionsRoute() {
    const { t } = useTranslation('mentorshipSessionsIndex');
    const { setNavHeading } = useNavHeadingStore();
    useEffect(() => {
        setNavHeading(<h1 className="text-lg">{t('navHeading')}</h1>);
    }, [setNavHeading, t]);

    const instituteId = getInstituteId();
    const [scheduleOpen, setScheduleOpen] = useState(false);

    return (
        <LayoutContainer>
            <div className="flex flex-col gap-6 p-6">
                <MentorshipPageHeader
                    title={t('title')}
                    subtitle={t('subtitle')}
                    icon={CalendarDots}
                >
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        onClick={() => setScheduleOpen(true)}
                        title={t('scheduleButtonTitle')}
                    >
                        <CalendarPlus size={18} /> {t('scheduleButtonLabel')}
                    </MyButton>
                </MentorshipPageHeader>
                <SessionStatsCounts instituteId={instituteId} />
                <MentorSessionsPanel instituteId={instituteId} />

                <ScheduleSessionDialog
                    instituteId={instituteId}
                    open={scheduleOpen}
                    onOpenChange={setScheduleOpen}
                />
            </div>
        </LayoutContainer>
    );
}
