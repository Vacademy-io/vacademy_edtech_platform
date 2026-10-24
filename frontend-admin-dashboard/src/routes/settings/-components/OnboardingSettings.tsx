/**
 * OnboardingSettings — institute settings tab for the Onboarding Flows feature.
 *
 * Master toggle (ONBOARDING_SETTING.enabled) gates the entire feature: the
 * "Onboarding" sidebar entry, the /audience-manager/onboarding routes, and
 * the student side-view "Onboarding" tab (see useOnboardingSettings).
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { MyButton } from '@/components/design-system/button';
import { toast } from 'sonner';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_INSITITUTE_SETTINGS } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OnboardingSettingsData {
    /** If false, the Onboarding Flows feature (sidebar entry, routes, side-view tab) is hidden institute-wide. */
    enabled: boolean;
}

const DEFAULT_ONBOARDING_SETTINGS: OnboardingSettingsData = {
    enabled: false,
};

const SETTING_KEY = 'ONBOARDING_SETTING';
const SAVE_URL = GET_INSITITUTE_SETTINGS.replace('/get', '/save-setting');

// ─── API ─────────────────────────────────────────────────────────────────────

const fetchOnboardingSettings = async (): Promise<OnboardingSettingsData> => {
    const instituteId = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_INSITITUTE_SETTINGS,
        params: { instituteId, settingKey: SETTING_KEY },
    });
    // GET returns the SettingDto itself ({key, name, data}) — response.data IS
    // the SettingDto, so its content is one level down at response.data.data
    // (matches GuardianSettings.tsx's fetchGuardianSettings, verified working).
    const saved = response.data?.data as Partial<OnboardingSettingsData> | undefined;
    if (!saved) return DEFAULT_ONBOARDING_SETTINGS;
    return { ...DEFAULT_ONBOARDING_SETTINGS, ...saved };
};

const saveOnboardingSettings = async (data: OnboardingSettingsData): Promise<void> => {
    const instituteId = getCurrentInstituteId();
    await authenticatedAxiosInstance.post(
        SAVE_URL,
        { setting_name: 'Onboarding Settings', setting_data: data },
        { params: { instituteId, settingKey: SETTING_KEY } }
    );
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function OnboardingSettings() {
    const { t } = useTranslation('settingsOnboarding');
    const queryClient = useQueryClient();
    const [settings, setSettings] = useState<OnboardingSettingsData>(DEFAULT_ONBOARDING_SETTINGS);
    const [hasChanges, setHasChanges] = useState(false);

    const { data, isLoading } = useQuery({
        queryKey: ['onboarding-settings'],
        queryFn: fetchOnboardingSettings,
        staleTime: 5 * 60 * 1000,
    });

    useEffect(() => {
        if (data) {
            setSettings(data);
            setHasChanges(false);
        }
    }, [data]);

    const { mutate: save, isPending: saving } = useMutation({
        mutationFn: saveOnboardingSettings,
        onSuccess: () => {
            toast.success(t('toasts.settingsSaved'));
            setHasChanges(false);
            queryClient.invalidateQueries({ queryKey: ['onboarding-settings'] });
            queryClient.invalidateQueries({ queryKey: ['onboarding-settings-config'] });
        },
        onError: () => {
            toast.error(t('toasts.saveFailed'));
        },
    });

    const update = (patch: Partial<OnboardingSettingsData>) => {
        setSettings((prev) => ({ ...prev, ...patch }));
        setHasChanges(true);
    };

    const handleSave = () => {
        save(settings);
    };

    return (
        <div className="p-6">
            <div className="space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle>{t('title')}</CardTitle>
                        <CardDescription>{t('description')}</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {isLoading ? (
                            <div className="text-body text-neutral-500">{t('loading')}</div>
                        ) : (
                            <div className="flex items-center gap-3">
                                <Switch
                                    id="onboarding-enabled"
                                    checked={settings.enabled}
                                    onCheckedChange={(v) => update({ enabled: v })}
                                />
                                <Label htmlFor="onboarding-enabled" className="cursor-pointer">
                                    {settings.enabled
                                        ? t('toggle.enabled')
                                        : t('toggle.disabled')}
                                </Label>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {!isLoading && (
                    <div className="flex items-center justify-end">
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onClick={handleSave}
                            disable={saving || !hasChanges}
                        >
                            {saving ? t('footer.saving') : t('footer.save')}
                        </MyButton>
                    </div>
                )}
            </div>
        </div>
    );
}
