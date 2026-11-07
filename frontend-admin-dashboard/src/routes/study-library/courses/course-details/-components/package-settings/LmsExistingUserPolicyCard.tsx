import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CircleNotch, UserGear } from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { getPackageSettingData, savePackageSettingKey } from '@/services/package-settings';

interface LmsExistingUserPolicyCardProps {
    packageId: string;
    refreshKey?: number;
}

const COURSE_SETTING_KEY = 'COURSE_SETTING';

type CourseSettingData = Record<string, unknown> & {
    lms?: Record<string, unknown> & { editExistingUser?: boolean };
};

/**
 * "When a learner already exists on the LMS, reset their password to ours?"
 *
 * Backs `COURSE_SETTING.data.lms.editExistingUser` for this course. The enrolment workflow reads
 * it (course setting first, institute setting as fallback — see `LmsExistingUserEditPolicyService`)
 * and puts the answer on the run context as `lmsEditExistingUser`; the edit-user HTTP node is
 * gated on it.
 *
 * Off by default and off when unset: the enrolment workflow looks the learner up by email and, on
 * a hit, keeps the existing account untouched. Turning this on makes it overwrite that account's
 * password with the one from here — a write to a system we don't own, and the reason a migration
 * (where we must NOT disturb existing accounts) leaves it off. Opt-in per course.
 */
export const LmsExistingUserPolicyCard: React.FC<LmsExistingUserPolicyCardProps> = ({
    packageId,
    refreshKey,
}) => {
    const { t } = useTranslation('studyLibraryLmsExistingUserPolicyCard');
    const [enabled, setEnabled] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = (await getPackageSettingData(
                packageId,
                COURSE_SETTING_KEY
            )) as CourseSettingData | null;
            setEnabled(data?.lms?.editExistingUser === true);
        } catch {
            // An unreadable setting means "not configured", which is the same as off. Don't
            // surface an error toast for a card the admin may not even be looking at.
            setEnabled(false);
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
            // merging is not optional — writing just { lms: {...} } would wipe every other
            // course setting stored under this key.
            const current = ((await getPackageSettingData(packageId, COURSE_SETTING_KEY)) ??
                {}) as CourseSettingData;
            const merged: CourseSettingData = {
                ...current,
                lms: { ...(current.lms ?? {}), editExistingUser: next },
            };
            await savePackageSettingKey(packageId, COURSE_SETTING_KEY, merged, t('courseSettings'));
            toast.success(
                next
                    ? t('passwordsWillBeReset')
                    : t('existingUsersLeftUntouched')
            );
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
                    <UserGear size={18} weight="duotone" className="text-neutral-500" />
                    {t('existingLmsUsers')}
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                        <Label htmlFor="lms-edit-existing-user" className="text-sm">
                            {t('resetPasswordOnEnrolment')}
                        </Label>
                        <p className="max-w-2xl text-caption text-neutral-500">
                            {t('resetPasswordDescription')}
                        </p>
                        <p className="max-w-2xl text-caption text-neutral-400">
                            {t('emailUnchangedDescription')}
                        </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 pt-1">
                        {(loading || saving) && (
                            <CircleNotch className="size-4 animate-spin text-neutral-400" />
                        )}
                        <Switch
                            id="lms-edit-existing-user"
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
