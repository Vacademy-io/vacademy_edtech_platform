import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_INSITITUTE_SETTINGS, SYNC_MAX_SESSIONS } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Fetch school settings
const fetchSettings = async () => {
    const instituteId = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_INSITITUTE_SETTINGS,
        params: { instituteId, settingKey: 'SCHOOL_SETTING' },
    });
    return response.data;
};

export default function MaxActiveSessionsSetting() {
    const { t } = useTranslation('settingsMaxActiveSessions');
    const queryClient = useQueryClient();
    const [maxActiveSessions, setMaxActiveSessions] = useState<number>(0);

    const { data: settingsData, isLoading } = useQuery({
        queryKey: ['school-settings'],
        queryFn: fetchSettings,
        staleTime: 5 * 60 * 1000,
    });

    useEffect(() => {
        if (settingsData) {
            const value =
                settingsData?.data?.MAX_ACTIVE_SESSIONS_SETTING?.data?.maxActiveSessions ?? 0;
            setMaxActiveSessions(value);
        }
    }, [settingsData]);

    const updateMutation = useMutation({
        mutationFn: async (value: number) => {
            const instituteId = getCurrentInstituteId();
            const existingSettingsData = settingsData?.data ?? {};

            // Save to admin-core-service
            await authenticatedAxiosInstance.post(
                `${GET_INSITITUTE_SETTINGS.replace('/get', '/save-setting')}`,
                {
                    setting_name: 'School Settings',
                    setting_data: {
                        ...existingSettingsData,
                        MAX_ACTIVE_SESSIONS_SETTING: {
                            key: 'MAX_ACTIVE_SESSIONS_SETTING',
                            name: 'Max Active Sessions Setting',
                            data: { maxActiveSessions: value },
                        },
                    },
                },
                { params: { instituteId, settingKey: 'SCHOOL_SETTING' } }
            );

            // Sync to auth-service (best-effort — setting is already saved above)
            try {
                await authenticatedAxiosInstance.post(SYNC_MAX_SESSIONS, {
                    institute_id: instituteId,
                    max_active_sessions: value,
                });
            } catch (syncError) {
                console.error('Auth-service sync failed:', syncError);
                toast.warning(t('toasts.syncFailed'));
            }
        },
        onSuccess: () => {
            toast.success(t('toasts.saveSuccess'));
            queryClient.invalidateQueries({ queryKey: ['school-settings'] });
        },
        onError: (error: any) => {
            toast.error(error?.response?.data?.message || t('toasts.saveFailed'));
        },
    });

    const handleSave = () => {
        updateMutation.mutate(maxActiveSessions);
    };

    if (isLoading) {
        return null;
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">{t('card.title')}</CardTitle>
                <CardDescription>{t('card.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="max-active-sessions">{t('field.label')}</Label>
                    <Input
                        id="max-active-sessions"
                        type="number"
                        min={0}
                        value={maxActiveSessions}
                        onChange={(e) => setMaxActiveSessions(Number(e.target.value))}
                    />
                    <p className="text-sm text-muted-foreground">{t('field.hint')}</p>
                </div>
                <div className="flex justify-end gap-3 border-t pt-4">
                    <MyButton
                        buttonType="primary"
                        onClick={handleSave}
                        disabled={updateMutation.isPending}
                    >
                        {updateMutation.isPending ? t('button.saving') : t('button.save')}
                    </MyButton>
                </div>
            </CardContent>
        </Card>
    );
}
