import { useIsMobile } from '@/hooks/use-mobile';
import { MyButton } from '@/components/design-system/button';
import { CalendarBlank } from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { useAssessmentActionVisibility } from '@/lib/display-settings/assessment-actions';
import { useTranslation } from 'react-i18next';

export const ScheduleTestHeaderDescription = () => {
    const isMobile = useIsMobile();
    const navigate = useNavigate();
    const { canCreate } = useAssessmentActionVisibility();
    const { t } = useTranslation('homeworkCreationScheduleTestHeaderDescription');

    const handleRedirectRoute = (type: string) => {
        navigate({
            to: '/homework-creation/create-assessment/$assessmentId/$examtype',
            params: {
                assessmentId: 'defaultId',
                examtype: type,
            },
            search: {
                currentStep: 0,
            },
        });
    };

    return (
        <div
            className={`mb-8 flex items-center justify-between ${
                isMobile ? 'flex-wrap gap-4' : 'gap-10'
            }`}
        >
            <div className="flex flex-col">
                <h1 className="text-h3 font-semibold text-neutral-600">
                    {t('heading')}
                </h1>
                <p className="text-neutral-600">{t('description')}</p>
            </div>
            {canCreate && (
                <MyButton
                    scale="large"
                    buttonType="primary"
                    layoutVariant="default"
                    id="create-assessment"
                    onClick={() => handleRedirectRoute('EXAM')}
                >
                    <CalendarBlank size={32} />
                    {t('createHomeworkButton')}
                </MyButton>
            )}
        </div>
    );
};
