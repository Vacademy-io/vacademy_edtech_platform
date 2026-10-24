import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CourseSettingsForm } from './CourseSettingsForm';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Warning, CheckCircle, CircleNotch, Gear } from '@phosphor-icons/react';
import { saveCourseSettings } from '@/services/course-settings';
import { CourseSettingsData } from '@/types/course-settings';
import { useCourseSettings } from '@/hooks/useCourseSettings';
import UserIdentifierSettings from '../UserIdentifierSettings';
import TerminationReasonSettings from '../TerminationReasonSettings';
import { TutorModeDefaultsCard } from './TutorModeDefaultsCard';
import { TutorInsightsCard } from '@/components/common/tutor/TutorInsightsCard';

const CourseSettings = () => {
    const { t } = useTranslation('settingsCourseSettings');
    const { settings, loading, error: contextError, refreshSettings } = useCourseSettings();
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // Error handling for component operations
    const handleError = (error: unknown, operationKey: string, operationLabel: string) => {
        console.error(`Error in ${operationKey}:`, error);
        setError(t('errors.generic', { operation: operationLabel }));
        setTimeout(() => setError(null), 5000);
    };

    const handleSaveSettings = async (updatedSettings: CourseSettingsData) => {
        try {
            setSaving(true);
            setError(null);
            await saveCourseSettings(updatedSettings);
            // Refresh the context to update all components using course settings
            await refreshSettings();
            setSuccess(t('success.saved'));
            setTimeout(() => setSuccess(null), 5000);
        } catch (error) {
            handleError(error, 'save course settings', t('errors.operations.saveCourseSettings'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Error Alert */}
            {(error || contextError) && (
                <Alert variant="destructive">
                    <Warning className="size-4" />
                    <AlertDescription>{error || contextError}</AlertDescription>
                </Alert>
            )}

            {/* Success Alert */}
            {success && (
                <Alert variant="default" className="border-green-200 bg-green-50 text-green-800">
                    <CheckCircle className="size-4" />
                    <AlertDescription>{success}</AlertDescription>
                </Alert>
            )}

            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="space-y-1">
                    <h1 className="flex items-center gap-2 text-lg font-bold">
                        <Gear className="size-6" />
                        {t('header.title')}
                    </h1>
                    <p className="text-sm text-muted-foreground">{t('header.subtitle')}</p>
                </div>
            </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center py-12">
                    <CircleNotch className="size-10 animate-spin text-primary-500" />
                    <p className="mt-4 text-gray-600">{t('loading')}</p>
                </div>
            ) : settings ? (
                <CourseSettingsForm
                    settings={settings}
                    onSave={handleSaveSettings}
                    isSaving={saving}
                />
            ) : (
                <Alert variant="destructive">
                    <Warning className="size-4" />
                    <AlertDescription>{t('errors.loadFailed')}</AlertDescription>
                </Alert>
            )}

            {/* Live AI Tutor: institute-wide defaults every course inherits. */}
            <TutorModeDefaultsCard />
            {/* Live AI Tutor: what the teacher learned across every course (WP9). */}
            <TutorInsightsCard />
            <UserIdentifierSettings />
            <TerminationReasonSettings />
        </div>
    );
};

export default CourseSettings;
