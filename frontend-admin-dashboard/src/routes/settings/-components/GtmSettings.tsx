import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { MyButton } from '@/components/design-system/button';
import { toast } from 'sonner';
import {
    DEFAULT_GTM_SETTINGS,
    GTM_SETTINGS_QUERY_KEY,
    fetchGtmSettings,
    saveGtmSettings,
    type GtmSettingsData,
} from '@/services/gtm-settings';

const GTM_ID_PATTERN = /^GTM-[A-Z0-9]+$/;

/**
 * Google Tag Manager container injection.
 *
 * Campaign-link settings used to live here too. They moved to their own card
 * (UtmSettings) because attribution is first-party and works with no container
 * at all — keeping them here hid the feature from every institute that has
 * never used a tag manager.
 */
export default function GtmSettings() {
    const { t } = useTranslation('settingsGtm');
    const queryClient = useQueryClient();
    const [settings, setSettings] = useState<GtmSettingsData>(DEFAULT_GTM_SETTINGS);
    const [hasChanges, setHasChanges] = useState(false);

    const { data, isLoading } = useQuery({
        queryKey: GTM_SETTINGS_QUERY_KEY,
        queryFn: fetchGtmSettings,
        staleTime: 5 * 60 * 1000,
    });

    useEffect(() => {
        if (!data) return;
        setSettings(data);
        setHasChanges(false);
    }, [data]);

    const { mutate: save, isPending: saving } = useMutation({
        mutationFn: saveGtmSettings,
        onSuccess: () => {
            toast.success(t('toasts.saveSuccess'));
            setHasChanges(false);
            queryClient.invalidateQueries({ queryKey: GTM_SETTINGS_QUERY_KEY });
        },
        onError: () => toast.error(t('toasts.saveError')),
    });

    const update = (patch: Partial<GtmSettingsData>) => {
        setSettings((prev) => ({ ...prev, ...patch }));
        setHasChanges(true);
    };

    const handleSave = () => {
        if (settings.enabled && !GTM_ID_PATTERN.test(settings.containerId)) {
            toast.error(t('errors.invalidContainerId'));
            return;
        }
        // `settings.utm` is carried through UNTOUCHED. Institutes configured
        // before UTM became its own setting still keep their toggle in this
        // blob, and the UTM service reads it as a fallback — dropping it here
        // would silently switch their campaign links off.
        save(settings);
    };

    if (isLoading) {
        return <div className="p-6 text-sm text-muted-foreground">{t('loading')}</div>;
    }

    return (
        <div className="space-y-6 p-6">
            <Card>
                <CardHeader>
                    <CardTitle>{t('card.title')}</CardTitle>
                    <CardDescription>
                        {t('card.description.part1')}
                        <code>enrollment_success</code>
                        {t('card.description.part2')}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-center gap-3">
                        <Switch
                            id="gtm-enabled"
                            checked={settings.enabled}
                            onCheckedChange={(v) => update({ enabled: v })}
                        />
                        <Label htmlFor="gtm-enabled" className="cursor-pointer">
                            {settings.enabled ? t('toggle.enabled') : t('toggle.disabled')}
                        </Label>
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="gtm-container-id">{t('containerId.label')}</Label>
                        <Input
                            id="gtm-container-id"
                            placeholder={t('containerId.placeholder')}
                            value={settings.containerId}
                            disabled={!settings.enabled}
                            onChange={(e) => update({ containerId: e.target.value.toUpperCase().trim() })}
                            className="max-w-xs"
                        />
                        <p className="text-xs text-muted-foreground">{t('containerId.hint')}</p>
                    </div>
                </CardContent>
            </Card>

            <div className="flex justify-end">
                <MyButton
                    buttonType="primary"
                    scale="medium"
                    disable={!hasChanges || saving}
                    onClick={handleSave}
                >
                    {saving ? t('footer.saving') : t('footer.save')}
                </MyButton>
            </div>
        </div>
    );
}
