import { useIsMobile } from '@/hooks/use-mobile';
import { MyButton } from '@/components/design-system/button';
import { CalendarBlank } from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { SettingsQuickAccessButton } from '@/components/settings/quick-access/SettingsQuickAccessButton';
import { SettingsTabs } from '@/routes/settings/-constants/terms';
import { Examination, Mock, Practice, Survey } from '@/svgs';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { cn } from '@/lib/utils';
import { useAssessmentActionVisibility } from '@/lib/display-settings/assessment-actions';
import { useTranslation } from 'react-i18next';

export const ScheduleTestHeaderDescription = ({
    isCourseOutline = false,
}: {
    isCourseOutline?: boolean;
}) => {
    const { t } = useTranslation('assessmentScheduleTestHeaderDescription');
    const isMobile = useIsMobile();
    const navigate = useNavigate();
    const { getCourseFromPackage } = useInstituteDetailsStore();
    const { canCreate } = useAssessmentActionVisibility();

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

    return (
        <div
            className={`mb-8 flex items-center justify-between ${
                isMobile ? 'flex-wrap gap-4' : 'gap-10'
            }`}
        >
            <div className="flex flex-col">
                <h1
                    className={cn(
                        'font-semibold text-neutral-600',
                        isCourseOutline ? 'text-base' : 'text-h3'
                    )}
                >
                    {t('heading')}
                </h1>
                <p className={cn('text-neutral-600', isCourseOutline && 'hidden')}>
                    {t('description')}
                </p>
            </div>
            <div className="flex items-center gap-2">
                <SettingsQuickAccessButton
                    settingsKey={SettingsTabs.Assessment}
                    label={t('assessmentSettingsLabel')}
                />
                {canCreate && (
                    <Dialog>
                        <DialogTrigger
                            disabled={getCourseFromPackage().length === 0}
                            className={cn(
                                getCourseFromPackage().length === 0 &&
                                    'pointer-events-none opacity-55'
                            )}
                        >
                            <MyButton
                                scale="large"
                                buttonType="primary"
                                layoutVariant="default"
                                id="create-assessment"
                            >
                                <CalendarBlank size={32} />
                                {t('createAssessmentButton')}
                            </MyButton>
                        </DialogTrigger>
                        <DialogContent className="no-scrollbar !m-0 flex h-screen !w-4/5 flex-col gap-8 overflow-y-auto !p-0">
                            <h1 className="rounded-lg bg-primary-50 p-4 font-semibold text-primary-500">
                                {t('createAssessmentDialogTitle')}
                            </h1>
                            <div className="mb-4 flex size-auto flex-col items-center justify-center gap-11">
                                <div className="flex items-center gap-12">
                                    <div
                                        onClick={() => handleRedirectRoute('EXAM')}
                                        className="flex size-72 cursor-pointer flex-col items-center rounded-xl border bg-neutral-50 p-8"
                                    >
                                        <Examination />
                                        <h1 className="text-h2 font-semibold">
                                            {t('examTypes.examination.title')}
                                        </h1>
                                        <p className="text-center text-sm text-neutral-500">
                                            {t('examTypes.examination.description')}
                                        </p>
                                    </div>
                                    <div
                                        onClick={() => handleRedirectRoute('MOCK')}
                                        className="flex size-72 cursor-pointer flex-col items-center rounded-xl border bg-neutral-50 p-8"
                                    >
                                        <Mock />
                                        <h1 className="text-h2 font-semibold">
                                            {t('examTypes.mock.title')}
                                        </h1>
                                        <p className="text-center text-sm text-neutral-500">
                                            {t('examTypes.mock.description')}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-12">
                                    <div
                                        onClick={() => handleRedirectRoute('PRACTICE')}
                                        className="flex size-72 cursor-pointer flex-col items-center rounded-xl border bg-neutral-50 p-8"
                                    >
                                        <Practice />
                                        <h1 className="text-h2 font-semibold">
                                            {t('examTypes.practice.title')}
                                        </h1>
                                        <p className="text-center text-sm text-neutral-500">
                                            {t('examTypes.practice.description')}
                                        </p>
                                    </div>
                                    <div
                                        onClick={() => handleRedirectRoute('SURVEY')}
                                        className="flex size-72 cursor-pointer flex-col items-center rounded-xl border bg-neutral-50 p-8"
                                    >
                                        <Survey />
                                        <h1 className="text-h2 font-semibold">
                                            {t('examTypes.survey.title')}
                                        </h1>
                                        <p className="text-center text-sm text-neutral-500">
                                            {t('examTypes.survey.description')}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </DialogContent>
                    </Dialog>
                )}
            </div>
        </div>
    );
};
