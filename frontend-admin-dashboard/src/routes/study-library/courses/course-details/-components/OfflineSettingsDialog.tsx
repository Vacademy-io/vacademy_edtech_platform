import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { MyDialog } from '@/components/design-system/dialog';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { CloudArrowDown, Prohibit, DotsThreeVertical } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { getCourseOfflineDefault, saveCourseOfflineDefault } from '@/services/offline-access';

interface OfflineSettingsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    packageId: string;
}

/**
 * Course header → "Offline settings": the course-wide default toggle for
 * offline downloads (`package.course_setting.offlineDefaultEnabled`, read by
 * the backend OfflineAccessResolver when no explicit rule exists on a node's
 * chain). Batch/subject/module/chapter/slide overrides live on each node's
 * own kebab menu — there is intentionally no whole-course override here.
 */
export const OfflineSettingsDialog: React.FC<OfflineSettingsDialogProps> = ({
    open,
    onOpenChange,
    packageId,
}) => {
    const { t } = useTranslation('studyLibraryOfflineSettingsDialog');
    const [enabled, setEnabled] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        let active = true;
        setLoading(true);
        getCourseOfflineDefault(packageId)
            .then((value) => active && setEnabled(value))
            .catch(() => active && toast.error(t('failedToLoadOfflineSettings')))
            .finally(() => active && setLoading(false));
        return () => {
            active = false;
        };
    }, [open, packageId, t]);

    const handleToggle = async (value: boolean) => {
        const previous = enabled;
        setEnabled(value);
        setSaving(true);
        try {
            await saveCourseOfflineDefault(packageId, value);
            toast.success(t('offlineSettingsSaved'));
        } catch {
            setEnabled(previous);
            toast.error(t('failedToSaveOfflineSettings'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <MyDialog
            heading={t('offlineSettings')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="w-full max-w-lg"
        >
            <div className="flex flex-col gap-4 p-1">
                <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                        <Label htmlFor="course-offline-default" className="flex items-center gap-2">
                            <CloudArrowDown className="size-4 text-primary-500" />
                            {t('allowOfflineDownloadsByDefault')}
                        </Label>
                        <p className="text-caption text-neutral-500">
                            {t('appliesToEverythingDescription')}
                        </p>
                    </div>
                    <Switch
                        id="course-offline-default"
                        checked={enabled}
                        onCheckedChange={handleToggle}
                        disabled={loading || saving}
                    />
                </div>

                <ul className="space-y-2 rounded-md bg-neutral-50 p-3 text-caption text-neutral-600">
                    <li className="flex items-start gap-2">
                        <DotsThreeVertical className="mt-0.5 size-4 shrink-0 text-neutral-400" />
                        <span>
                            <Trans
                                t={t}
                                i18nKey="fineTuneFromMenu"
                                components={{ strong: <span className="font-medium" /> }}
                            />
                        </span>
                    </li>
                    <li className="flex items-start gap-2">
                        <Prohibit className="mt-0.5 size-4 shrink-0 text-neutral-400" />
                        <span>
                            <Trans
                                t={t}
                                i18nKey="blockAlwaysWins"
                                components={{ strong: <span className="font-medium" /> }}
                            />
                        </span>
                    </li>
                    <li className="flex items-start gap-2">
                        <CloudArrowDown className="mt-0.5 size-4 shrink-0 text-neutral-400" />
                        <span>{t('embeddedContentNeedsInternet')}</span>
                    </li>
                </ul>
            </div>
        </MyDialog>
    );
};
