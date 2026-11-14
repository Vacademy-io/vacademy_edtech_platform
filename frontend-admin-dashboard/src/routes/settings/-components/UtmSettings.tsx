import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { MyButton } from '@/components/design-system/button';
import { toast } from 'sonner';
import { SUGGESTED_MEDIUMS, SUGGESTED_SOURCES, normalizeUtmValue } from '@/lib/utm';
import { getLearnerPortalUrl } from '@/lib/learner-portal-url';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { UtmBuilderDialog } from '@/components/common/utm/utm-builder-dialog';
import { DEFAULT_UTM_SETTINGS, type UtmSettingsData } from '@/services/gtm-settings';
import {
    UTM_SETTINGS_QUERY_KEY,
    fetchUtmSettings,
    saveUtmSettings,
} from '@/services/utm-settings';

/** Pages an admin most often tags that have no share menu of their own. */
const ANY_PAGE_PRESETS = [
    { key: 'login', path: '/login' },
    { key: 'signup', path: '/signup' },
    { key: 'home', path: '/' },
] as const;

/** Comma-separated text -> a clean, de-duplicated list of UTM-safe values. */
const parseList = (text: string): string[] =>
    Array.from(
        new Set(
            text
                .split(',')
                .map((entry) => normalizeUtmValue(entry))
                .filter(Boolean)
        )
    );

/**
 * Campaign link settings.
 *
 * Deliberately NOT part of the GTM card. Attribution here is first-party: the
 * capture and the beacon are ours, so an institute with no tag manager still
 * gets full campaign reporting on every learner. A container only matters if
 * they want their own Analytics to read the same parameters. Filing this under
 * "GTM" hid it from exactly the schools most likely to want it.
 */
export default function UtmSettings() {
    const { t } = useTranslation('settingsGtm');
    const queryClient = useQueryClient();
    const [utm, setUtm] = useState<UtmSettingsData>(DEFAULT_UTM_SETTINGS);
    const [sourcesText, setSourcesText] = useState('');
    const [mediumsText, setMediumsText] = useState('');
    const [hasChanges, setHasChanges] = useState(false);
    const [anyPagePath, setAnyPagePath] = useState('/login');
    const [anyPageOpen, setAnyPageOpen] = useState(false);
    const { instituteDetails } = useInstituteDetailsStore();

    // Built against the institute's OWN learner domain, never the shared
    // fallback — a link on learner.vacademy.io leaks Vacademy branding into
    // the message and into its unfurl preview.
    const anyPageUrl = getLearnerPortalUrl(
        anyPagePath.trim() || '/',
        instituteDetails?.learner_portal_base_url
    );

    const { data, isLoading } = useQuery({
        queryKey: UTM_SETTINGS_QUERY_KEY,
        queryFn: fetchUtmSettings,
        staleTime: 5 * 60 * 1000,
    });

    useEffect(() => {
        if (!data) return;
        setUtm(data);
        setSourcesText(data.sources.join(', '));
        setMediumsText(data.mediums.join(', '));
        setHasChanges(false);
    }, [data]);

    const { mutate: save, isPending: saving } = useMutation({
        mutationFn: saveUtmSettings,
        onSuccess: () => {
            toast.success(t('toasts.saveSuccess'));
            setHasChanges(false);
            queryClient.invalidateQueries({ queryKey: UTM_SETTINGS_QUERY_KEY });
        },
        onError: () => toast.error(t('toasts.saveError')),
    });

    const updateUtm = (patch: Partial<UtmSettingsData>) => {
        setUtm((prev) => ({ ...prev, ...patch }));
        setHasChanges(true);
    };

    if (isLoading) {
        return <div className="p-6 text-sm text-muted-foreground">{t('loading')}</div>;
    }

    return (
        <div className="space-y-6 p-6">
            <Card>
                <CardHeader>
                    <CardTitle>{t('utm.card.title')}</CardTitle>
                    <CardDescription>{t('utm.card.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                    <div className="flex items-center gap-3">
                        <Switch
                            id="utm-enabled"
                            checked={utm.enabled}
                            onCheckedChange={(v) => updateUtm({ enabled: v })}
                        />
                        <Label htmlFor="utm-enabled" className="cursor-pointer">
                            {utm.enabled ? t('toggle.enabled') : t('toggle.disabled')}
                        </Label>
                    </div>

                    <p className="text-xs text-muted-foreground">{t('utm.surfacesHint')}</p>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="utm-default-source">
                                {t('utm.defaultSource.label')}
                            </Label>
                            <Input
                                id="utm-default-source"
                                list="utm-settings-source-suggestions"
                                placeholder={t('utm.defaultSource.placeholder')}
                                value={utm.defaultSource}
                                disabled={!utm.enabled}
                                onChange={(e) =>
                                    updateUtm({ defaultSource: normalizeUtmValue(e.target.value) })
                                }
                                className="w-full"
                            />
                            <datalist id="utm-settings-source-suggestions">
                                {SUGGESTED_SOURCES.map((s) => (
                                    <option key={s} value={s} />
                                ))}
                            </datalist>
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="utm-default-medium">
                                {t('utm.defaultMedium.label')}
                            </Label>
                            <Input
                                id="utm-default-medium"
                                list="utm-settings-medium-suggestions"
                                placeholder={t('utm.defaultMedium.placeholder')}
                                value={utm.defaultMedium}
                                disabled={!utm.enabled}
                                onChange={(e) =>
                                    updateUtm({ defaultMedium: normalizeUtmValue(e.target.value) })
                                }
                                className="w-full"
                            />
                            <datalist id="utm-settings-medium-suggestions">
                                {SUGGESTED_MEDIUMS.map((m) => (
                                    <option key={m} value={m} />
                                ))}
                            </datalist>
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="utm-sources">{t('utm.sources.label')}</Label>
                            <Input
                                id="utm-sources"
                                placeholder={t('utm.sources.placeholder')}
                                value={sourcesText}
                                disabled={!utm.enabled}
                                onChange={(e) => {
                                    setSourcesText(e.target.value);
                                    setHasChanges(true);
                                }}
                                className="w-full"
                            />
                            <p className="text-xs text-muted-foreground">{t('utm.sources.hint')}</p>
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="utm-mediums">{t('utm.mediums.label')}</Label>
                            <Input
                                id="utm-mediums"
                                placeholder={t('utm.mediums.placeholder')}
                                value={mediumsText}
                                disabled={!utm.enabled}
                                onChange={(e) => {
                                    setMediumsText(e.target.value);
                                    setHasChanges(true);
                                }}
                                className="w-full"
                            />
                            <p className="text-xs text-muted-foreground">{t('utm.mediums.hint')}</p>
                        </div>
                    </div>

                    <div className="flex items-start gap-3">
                        <Switch
                            id="utm-require-campaign"
                            checked={utm.requireCampaign}
                            disabled={!utm.enabled}
                            onCheckedChange={(v) => updateUtm({ requireCampaign: v })}
                        />
                        <div>
                            <Label htmlFor="utm-require-campaign" className="cursor-pointer">
                                {t('utm.requireCampaign.label')}
                            </Label>
                            <p className="text-xs text-muted-foreground">
                                {t('utm.requireCampaign.hint')}
                            </p>
                        </div>
                    </div>

                    {/* Build a tagged link for a page that has no share menu of
                        its own — the login and sign-up pages, or any landing
                        page. Capture already runs on EVERY learner route, so a
                        link built here works with no further change; it simply
                        has no kebab menu to generate it from. */}
                    <div className="space-y-2 border-t border-neutral-200 pt-4">
                        <Label htmlFor="utm-any-page">{t('utm.anyPage.label')}</Label>
                        <p className="text-xs text-muted-foreground">
                            {t('utm.anyPage.hint')}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                            {ANY_PAGE_PRESETS.map((preset) => (
                                <button
                                    key={preset.path}
                                    type="button"
                                    disabled={!utm.enabled}
                                    onClick={() => setAnyPagePath(preset.path)}
                                    className="rounded-full border border-neutral-200 px-3 py-1 text-xs text-neutral-600 transition-colors hover:border-primary-300 hover:text-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {t(`utm.anyPage.presets.${preset.key}`)}
                                </button>
                            ))}
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row">
                            <Input
                                id="utm-any-page"
                                value={anyPagePath}
                                disabled={!utm.enabled}
                                placeholder={t('utm.anyPage.placeholder')}
                                onChange={(e) => setAnyPagePath(e.target.value)}
                                className="sm:max-w-sm"
                            />
                            <MyButton
                                buttonType="secondary"
                                scale="medium"
                                disable={!utm.enabled || !anyPagePath.trim()}
                                onClick={() => setAnyPageOpen(true)}
                            >
                                {t('utm.anyPage.action')}
                            </MyButton>
                        </div>
                        <p className="break-all text-xs text-neutral-400">{anyPageUrl}</p>
                    </div>
                </CardContent>
            </Card>

            <UtmBuilderDialog
                open={anyPageOpen}
                onOpenChange={setAnyPageOpen}
                baseUrl={anyPageUrl}
                sourceType="CUSTOM"
                entityName={anyPagePath.trim() || '/'}
            />

            <div className="flex justify-end">
                <MyButton
                    buttonType="primary"
                    scale="medium"
                    disable={!hasChanges || saving}
                    onClick={() =>
                        save({
                            ...utm,
                            sources: parseList(sourcesText),
                            mediums: parseList(mediumsText),
                        })
                    }
                >
                    {saving ? t('footer.saving') : t('utm.footer.save')}
                </MyButton>
            </div>
        </div>
    );
}
