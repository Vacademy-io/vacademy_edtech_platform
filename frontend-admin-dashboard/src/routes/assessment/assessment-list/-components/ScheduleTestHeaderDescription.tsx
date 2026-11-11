import { useIsMobile } from '@/hooks/use-mobile';
import { MyButton } from '@/components/design-system/button';
import { CalendarBlank } from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { MyDialog } from '@/components/design-system/dialog';
import { SettingsQuickAccessButton } from '@/components/settings/quick-access/SettingsQuickAccessButton';
import { SettingsTabs } from '@/routes/settings/-constants/terms';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { cn } from '@/lib/utils';
import { useAssessmentActionVisibility } from '@/lib/display-settings/assessment-actions';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { QuickOfflineTestDialog } from '@/routes/assessment/-components/offline-test/QuickOfflineTestDialog';
import { AssessmentTypePicker, type AssessmentTypeKey } from './AssessmentTypePicker';

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
    const [typeDialogOpen, setTypeDialogOpen] = useState(false);
    // Written paper (copy check) opens the one-screen form, not the wizard.
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

    const noCourses = getCourseFromPackage().length === 0;

    const handlePick = (type: AssessmentTypeKey) => {
        setTypeDialogOpen(false);
        // Written paper (copy check) opens the one-screen form, not the wizard.
        if (type === 'MANUAL_UPLOAD_EXAM') {
            setOfflineOpen(true);
            return;
        }
        handleRedirectRoute(type);
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
                    <MyDialog
                        open={typeDialogOpen}
                        onOpenChange={setTypeDialogOpen}
                        heading={t('createAssessmentDialogTitle')}
                        dialogWidth="max-w-4xl"
                        dialogId="create-assessment-type"
                        trigger={
                            <MyButton
                                scale="large"
                                buttonType="primary"
                                layoutVariant="default"
                                id="create-assessment"
                                disable={noCourses}
                            >
                                <CalendarBlank size={32} />
                                {t('createAssessmentButton')}
                            </MyButton>
                        }
                    >
                        <AssessmentTypePicker onPick={handlePick} />
                    </MyDialog>
                )}
                {canCreate && (
                    <QuickOfflineTestDialog open={offlineOpen} onOpenChange={setOfflineOpen} />
                )}
            </div>
        </div>
    );
};
