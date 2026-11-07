import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { MyButton } from '@/components/design-system/button';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_INSITITUTE_SETTINGS } from '@/constants/urls';
import { getInstituteId } from '@/constants/helper';

// Per-role setting, saved via the generic setting endpoints. Stored as
// { version, roles: { ROLE: boolean } }. The legacy institute-wide shape
// { enabled: boolean } is still read as a fallback.
const SETTING_KEY = 'SLIDE_CONTENT_PROTECTION_SETTING';
const SAVE_URL = GET_INSITITUTE_SETTINGS.replace('/get', '/save-setting');

interface ContentProtectionData {
    version?: number;
    roles?: Record<string, boolean>;
    enabled?: boolean; // legacy institute-wide
}

const fetchData = async (): Promise<ContentProtectionData> => {
    const instituteId = getInstituteId();
    try {
        const response = await authenticatedAxiosInstance({
            method: 'GET',
            url: GET_INSITITUTE_SETTINGS,
            params: { instituteId, settingKey: SETTING_KEY },
        });
        const data = response.data?.data;
        return data && typeof data === 'object' ? data : {};
    } catch {
        return {};
    }
};

const saveData = async (data: ContentProtectionData): Promise<void> => {
    const instituteId = getInstituteId();
    await authenticatedAxiosInstance.post(
        SAVE_URL,
        { setting_name: 'Slide Content Protection', setting_data: data },
        { params: { instituteId, settingKey: SETTING_KEY } }
    );
};

interface SlideContentProtectionCardProps {
    /** Canonical stored role key (ADMIN / TEACHER / LEARNER or a custom role name, uppercased). */
    roleKey: string;
    /** Display label for this role, used in the card copy. */
    roleLabel: string;
}

/**
 * Per-role toggle: when on, the learner app blocks right-click and the common
 * DevTools / view-source shortcuts on slides for that role. Best-effort
 * deterrent only. Edits just this role's entry in the shared blob.
 */
export default function SlideContentProtectionCard({
    roleKey,
    roleLabel,
}: SlideContentProtectionCardProps) {
    const { t } = useTranslation('settingsSlideContentProtectionCard');
    const queryClient = useQueryClient();
    const [enabled, setEnabled] = useState(false);
    const [dirty, setDirty] = useState(false);

    const { data, isLoading } = useQuery({
        queryKey: ['slide-content-protection'],
        queryFn: fetchData,
        staleTime: 5 * 60 * 1000,
    });

    useEffect(() => {
        if (data) {
            const v = data.roles?.[roleKey];
            // Fall back to the legacy institute-wide flag if this role is unset.
            setEnabled(typeof v === 'boolean' ? v : !!data.enabled);
            setDirty(false);
        }
    }, [data, roleKey]);

    const { mutate: save, isPending: saving } = useMutation({
        mutationFn: () => {
            const roles = { ...(data?.roles ?? {}), [roleKey]: enabled };
            return saveData({ version: 1, roles });
        },
        onSuccess: () => {
            toast.success(t('toasts.saveSuccess'));
            setDirty(false);
            queryClient.invalidateQueries({ queryKey: ['slide-content-protection'] });
        },
        onError: () => {
            toast.error(t('toasts.saveFailed'));
        },
    });

    if (isLoading) return null;

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('card.title')}</CardTitle>
                <CardDescription>
                    {t('card.description.part1')} {roleLabel}{' '}
                    {t('card.description.part2')}{' '}
                    <code className="rounded bg-neutral-100 px-1 text-xs">?access=dev</code>{' '}
                    {t('card.description.part3')}
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                    <Label
                        htmlFor={`slide-content-protection-${roleKey}`}
                        className="cursor-pointer text-sm font-medium text-neutral-800"
                    >
                        {t('toggle.label')}
                    </Label>
                    <Switch
                        id={`slide-content-protection-${roleKey}`}
                        checked={enabled}
                        onCheckedChange={(v) => {
                            setEnabled(v);
                            setDirty(true);
                        }}
                    />
                </div>
                <div className="flex justify-end border-t pt-4">
                    <MyButton
                        buttonType="primary"
                        onClick={() => save()}
                        disable={saving || !dirty}
                    >
                        {saving ? t('button.saving') : t('button.save')}
                    </MyButton>
                </div>
            </CardContent>
        </Card>
    );
}
