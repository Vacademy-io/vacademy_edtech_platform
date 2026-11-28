/**
 * Settings → Lead Settings → Forms.
 *
 * Institute-wide DEFAULT post-submit configuration for audience-list forms.
 * Saved under the `AUDIENCE_FORM_SETTING` institute setting and prefilled into
 * every NEW campaign created in Audience Manager, so a thank-you screen /
 * redirect is configured once for the whole institute instead of per list.
 *
 * Editing here never rewrites campaigns that are already saved — each campaign
 * keeps its own copy in `audience.setting_json` from the moment it is created.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import PostSubmitConfigurationEditor from '@/components/audience/PostSubmitConfigurationEditor';
import {
    AudienceFormSettings as AudienceFormSettingsShape,
    DEFAULT_AUDIENCE_FORM_SETTINGS,
    DEFAULT_POST_SUBMIT_CONFIGURATION,
    fetchAudienceFormSettings,
    saveAudienceFormSettings,
    validatePostSubmitConfiguration,
} from '@/services/audience-post-submit-settings';

export const AUDIENCE_FORM_SETTINGS_QUERY_KEY = ['audience-form-settings'];

export default function AudienceFormSettings() {
    const { t } = useTranslation('settingsAudienceFormSettings');
    const queryClient = useQueryClient();
    const [settings, setSettings] = useState<AudienceFormSettingsShape>(
        DEFAULT_AUDIENCE_FORM_SETTINGS
    );
    const [hasChanges, setHasChanges] = useState(false);
    const config = settings.postSubmit;

    const { data, isLoading } = useQuery({
        queryKey: AUDIENCE_FORM_SETTINGS_QUERY_KEY,
        queryFn: fetchAudienceFormSettings,
        staleTime: 5 * 60 * 1000,
    });

    useEffect(() => {
        if (data) {
            setSettings(data);
            setHasChanges(false);
        }
    }, [data]);

    const { mutate: save, isPending: saving } = useMutation({
        mutationFn: saveAudienceFormSettings,
        onSuccess: () => {
            toast.success(t('toasts.saved'));
            setHasChanges(false);
            queryClient.invalidateQueries({ queryKey: AUDIENCE_FORM_SETTINGS_QUERY_KEY });
        },
        onError: () => {
            toast.error(t('toasts.saveFailed'));
        },
    });

    const handleSave = () => {
        const error = validatePostSubmitConfiguration(config);
        if (error) {
            toast.error(error);
            return;
        }
        save(settings);
    };

    const handleResetToDefaults = () => {
        // Copy, not the shared module constant: `buttons` is an array and one
        // stray mutation would poison every later read of the default.
        setSettings((prev) => ({
            ...prev,
            postSubmit: { ...DEFAULT_POST_SUBMIT_CONFIGURATION, buttons: [] },
        }));
        setHasChanges(true);
    };

    if (isLoading) {
        return <div className="text-body text-neutral-500">{t('loading')}</div>;
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>{t('header.title')}</CardTitle>
                    <CardDescription>{t('header.description')}</CardDescription>
                </CardHeader>
                <CardContent>
                    <PostSubmitConfigurationEditor
                        value={config}
                        withCard={false}
                        onChange={(next) => {
                            setSettings((prev) => ({ ...prev, postSubmit: next }));
                            setHasChanges(true);
                        }}
                    />
                </CardContent>
            </Card>

            {/* Feature switch, not a default: this decides whether the Form
                Appearance card appears in the campaign create/edit dialog at
                all. Off means the dialog looks exactly as it always did. */}
            <Card>
                <CardHeader>
                    <CardTitle>{t('formAppearance.title')}</CardTitle>
                    <CardDescription>{t('formAppearance.description')}</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-row items-center justify-between gap-4 rounded-lg border border-neutral-200 p-4">
                        <div className="space-y-0.5">
                            <Label className="text-sm font-semibold">
                                {t('formAppearance.toggleLabel')}
                            </Label>
                            <p className="text-xs text-neutral-500">
                                {t('formAppearance.toggleHelp')}
                            </p>
                        </div>
                        <Switch
                            checked={settings.formAppearanceEnabled}
                            onCheckedChange={(checked) => {
                                setSettings((prev) => ({
                                    ...prev,
                                    formAppearanceEnabled: checked,
                                }));
                                setHasChanges(true);
                            }}
                        />
                    </div>
                </CardContent>
            </Card>

            {/* Short links. Unlike the switch above this one ships ON — it adds a
                convenience to a link the admin was already sharing rather than a
                new respondent-facing surface — so the copy has to describe
                turning it OFF, not on. */}
            <Card>
                <CardHeader>
                    <CardTitle>{t('shortLinks.title')}</CardTitle>
                    <CardDescription>{t('shortLinks.description')}</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-row items-center justify-between gap-4 rounded-lg border border-neutral-200 p-4">
                        <div className="space-y-0.5">
                            <Label className="text-sm font-semibold">
                                {t('shortLinks.toggleLabel')}
                            </Label>
                            <p className="text-xs text-neutral-500">{t('shortLinks.toggleHelp')}</p>
                        </div>
                        <Switch
                            checked={settings.shortLinksEnabled}
                            onCheckedChange={(checked) => {
                                setSettings((prev) => ({
                                    ...prev,
                                    shortLinksEnabled: checked,
                                }));
                                setHasChanges(true);
                            }}
                        />
                    </div>
                </CardContent>
            </Card>

            <div className="flex items-center justify-end gap-3">
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    onClick={handleResetToDefaults}
                    disabled={saving}
                >
                    {t('actions.restoreDefaults')}
                </MyButton>
                <MyButton
                    type="button"
                    buttonType="primary"
                    scale="medium"
                    onClick={handleSave}
                    disabled={saving || !hasChanges}
                >
                    {saving ? t('actions.saving') : t('actions.saveChanges')}
                </MyButton>
            </div>
        </div>
    );
}
