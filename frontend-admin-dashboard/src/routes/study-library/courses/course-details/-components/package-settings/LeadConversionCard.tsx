import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CircleNotch, GraduationCap } from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { getPackageSettingData, savePackageSettingKey } from '@/services/package-settings';

interface LeadConversionCardProps {
    packageId: string;
    refreshKey?: number;
}

const COURSE_SETTING_KEY = 'COURSE_SETTING';

type CourseSettingData = Record<string, unknown> & {
    leads?: Record<string, unknown> & { countEnrollmentAsConversion?: boolean };
};

/**
 * "Does enrolling into this course convert the lead?"
 *
 * Backs `COURSE_SETTING.data.leads.countEnrollmentAsConversion` for this course. The enrolment
 * paths read it through `LeadConversionPolicyService` (course setting first, institute setting as
 * fallback, converting by default) before flipping `user_lead_profile.conversion_status` to
 * CONVERTED — which is what drops the lead out of the default leads list, shows the "Converted"
 * badge against it, and counts it in the conversion KPIs.
 *
 * ON by default and ON when unset, because that is the behaviour every course already has. Turn it
 * off for a free course, trial, webinar or lead magnet, where enrolling is a top-of-funnel action
 * and the lead is still open. Only affects enrolments from here on — leads already marked
 * converted stay converted (change those from the lead's side view).
 */
export const LeadConversionCard: React.FC<LeadConversionCardProps> = ({ packageId, refreshKey }) => {
    const { t } = useTranslation('studyLibraryLeadConversionCard');
    // Defaults to true: an unset (or unreadable) setting means "convert", matching the backend.
    const [enabled, setEnabled] = useState(true);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = (await getPackageSettingData(
                packageId,
                COURSE_SETTING_KEY
            )) as CourseSettingData | null;
            setEnabled(data?.leads?.countEnrollmentAsConversion !== false);
        } catch {
            // An unreadable setting means "not configured", which is the same as on. Don't
            // surface an error toast for a card the admin may not even be looking at.
            setEnabled(true);
        } finally {
            setLoading(false);
        }
    }, [packageId]);

    useEffect(() => {
        void load();
    }, [load, refreshKey]);

    const handleToggle = async (next: boolean) => {
        setSaving(true);
        // Optimistic: the switch should move under the finger, not after a round trip.
        setEnabled(next);
        try {
            // Read-modify-write. save-setting replaces the WHOLE COURSE_SETTING data blob, so
            // merging is not optional — writing just { leads: {...} } would wipe every other
            // course setting stored under this key.
            const current = ((await getPackageSettingData(packageId, COURSE_SETTING_KEY)) ??
                {}) as CourseSettingData;
            const merged: CourseSettingData = {
                ...current,
                leads: { ...(current.leads ?? {}), countEnrollmentAsConversion: next },
            };
            await savePackageSettingKey(packageId, COURSE_SETTING_KEY, merged, t('courseSettings'));
            toast.success(next ? t('willConvert') : t('willNotConvert'));
        } catch {
            setEnabled(!next);
            toast.error(t('couldNotSaveSetting'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card className="shadow-none">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-body font-semibold">
                    <GraduationCap size={18} weight="duotone" className="text-neutral-500" />
                    {t('leadConversion')}
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                        <Label htmlFor="lead-count-enrollment-as-conversion" className="text-sm">
                            {t('countEnrollmentAsConversion')}
                        </Label>
                        <p className="max-w-2xl text-caption text-neutral-500">
                            {t('countEnrollmentDescription')}
                        </p>
                        <p className="max-w-2xl text-caption text-neutral-400">
                            {t('freeCourseHint')}
                        </p>
                        <p className="max-w-2xl text-caption text-neutral-400">
                            {t('notRetroactiveHint')}
                        </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 pt-1">
                        {(loading || saving) && (
                            <CircleNotch className="size-4 animate-spin text-neutral-400" />
                        )}
                        <Switch
                            id="lead-count-enrollment-as-conversion"
                            checked={enabled}
                            disabled={loading || saving}
                            onCheckedChange={(next) => void handleToggle(next)}
                        />
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};
