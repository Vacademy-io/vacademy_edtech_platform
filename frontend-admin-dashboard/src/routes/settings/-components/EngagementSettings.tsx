import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkle, WarningCircle } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import {
    DEFAULT_ENGAGEMENT_SETTINGS,
    ENGAGEMENT_SETTING_RANGES,
    getEngagementSettings,
    saveEngagementSettings,
    type EngagementNumericSetting,
    type EngagementSettings as Settings,
} from '../-services/engagement-settings';

/** Numbers are held as typed text so an empty or out-of-range box can be flagged. */
type FormState = Record<EngagementNumericSetting, string> & {
    allowUnverifiedScoreBonus: boolean;
};

const toForm = (s: Settings): FormState => ({
    dailyItemCap: String(s.dailyItemCap),
    minScrollPercent: String(s.minScrollPercent),
    minReadSeconds: String(s.minReadSeconds),
    minGameSeconds: String(s.minGameSeconds),
    allowUnverifiedScoreBonus: s.allowUnverifiedScoreBonus,
});

/** True when the typed value is a whole number inside the server's range. */
function isValid(key: EngagementNumericSetting, raw: string): boolean {
    if (!/^\d+$/.test(raw.trim())) return false;
    const n = Number(raw);
    return n >= ENGAGEMENT_SETTING_RANGES[key].min && n <= ENGAGEMENT_SETTING_RANGES[key].max;
}

/**
 * Settings → Daily Engagement.
 *
 * The knobs behind the learner home-page tasks. Each explains its consequence, because
 * the numbers are easy to set badly: a cap of 20 buries learners in several batches,
 * and a 0-second read gate turns readings into free points.
 *
 * Save stays disabled until the saved values have loaded: saving defaults over a
 * failed load would overwrite the institute's real settings.
 */
export default function EngagementSettings() {
    const { t } = useTranslation('engagement');
    const queryClient = useQueryClient();
    const {
        data: loaded,
        isLoading,
        isError,
        refetch,
        isFetching,
    } = useQuery({
        queryKey: ['engagement-settings'],
        queryFn: getEngagementSettings,
    });

    const [form, setForm] = useState<FormState>(() => toForm(DEFAULT_ENGAGEMENT_SETTINGS));
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (loaded) {
            setForm(toForm(loaded.settings));
            setDirty(false);
        }
    }, [loaded]);

    function patch(p: Partial<FormState>) {
        setForm((f) => ({ ...f, ...p }));
        setDirty(true);
    }

    const numericKeys = Object.keys(ENGAGEMENT_SETTING_RANGES) as EngagementNumericSetting[];
    const invalid = numericKeys.some((k) => !isValid(k, form[k]));

    async function save() {
        if (!loaded || invalid) return;
        setSaving(true);
        try {
            await saveEngagementSettings(
                {
                    dailyItemCap: Number(form.dailyItemCap),
                    minScrollPercent: Number(form.minScrollPercent),
                    minReadSeconds: Number(form.minReadSeconds),
                    minGameSeconds: Number(form.minGameSeconds),
                    allowUnverifiedScoreBonus: form.allowUnverifiedScoreBonus,
                },
                loaded.extra
            );
            await queryClient.invalidateQueries({ queryKey: ['engagement-settings'] });
            setDirty(false);
            toast.success(t('settings.saved'));
        } catch {
            toast.error(t('settings.saveError'));
        } finally {
            setSaving(false);
        }
    }

    function numberField(
        key: EngagementNumericSetting,
        id: string,
        labelKey: string,
        defaultValue: number
    ) {
        const { min, max } = ENGAGEMENT_SETTING_RANGES[key];
        const bad = !isValid(key, form[key]);
        return (
            <div className="space-y-1.5">
                <Label htmlFor={id}>{t(labelKey)}</Label>
                <Input
                    id={id}
                    type="number"
                    inputMode="numeric"
                    min={min}
                    max={max}
                    step={1}
                    value={form[key]}
                    aria-invalid={bad}
                    aria-describedby={`${id}-hint`}
                    className={cn(bad && 'border-danger-500 focus-visible:ring-danger-500')}
                    onChange={(e) => patch({ [key]: e.target.value } as Partial<FormState>)}
                />
                <p
                    id={`${id}-hint`}
                    className={cn('text-xs', bad ? 'text-danger-600' : 'text-neutral-500')}
                >
                    {bad
                        ? t('settings.rangeError', { min, max })
                        : t('settings.default', { value: defaultValue })}
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="flex items-center gap-2 text-xl font-semibold text-neutral-900">
                        <Sparkle size={20} /> {t('settings.title')}
                    </h2>
                    <p className="mt-1 text-sm text-neutral-500">{t('settings.subtitle')}</p>
                </div>
                <div className="flex gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        disable={!loaded}
                        onClick={() => {
                            setForm(toForm(DEFAULT_ENGAGEMENT_SETTINGS));
                            setDirty(true);
                        }}
                    >
                        {t('settings.reset')}
                    </MyButton>
                    <MyButton
                        type="button"
                        disable={!loaded || !dirty || saving || invalid}
                        onClick={save}
                    >
                        {saving ? t('settings.saving') : t('settings.save')}
                    </MyButton>
                </div>
            </div>

            {isLoading && (
                <div className="space-y-4" aria-busy="true">
                    {[0, 1, 2].map((i) => (
                        <Skeleton key={i} className="h-36 w-full rounded-lg" />
                    ))}
                </div>
            )}

            {/* A failed background refetch keeps the values that did load, so only a
                first load that failed hides the form. */}
            {isError && !loaded && (
                <Alert className="border-danger-200 bg-danger-50">
                    <WarningCircle size={18} className="text-danger-600" />
                    <AlertTitle className="text-danger-700">{t('settings.loadError')}</AlertTitle>
                    <AlertDescription className="space-y-3 text-danger-700">
                        <p>{t('settings.loadErrorHint')}</p>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            disable={isFetching}
                            onClick={() => void refetch()}
                        >
                            {t('settings.retry')}
                        </MyButton>
                    </AlertDescription>
                </Alert>
            )}

            {loaded && (
                <>
                    {dirty && (
                        <p className="rounded-md border border-warning-200 bg-warning-50 px-4 py-2 text-sm text-warning-700">
                            {t('settings.unsaved')}
                        </p>
                    )}

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">{t('settings.loadTitle')}</CardTitle>
                            <CardDescription>{t('settings.loadHint')}</CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-4 sm:grid-cols-2">
                            {numberField(
                                'dailyItemCap',
                                'eng-cap',
                                'settings.cap',
                                DEFAULT_ENGAGEMENT_SETTINGS.dailyItemCap
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">
                                {t('settings.readingTitle')}
                            </CardTitle>
                            <CardDescription>{t('settings.readingHint')}</CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-4 sm:grid-cols-2">
                            {numberField(
                                'minScrollPercent',
                                'eng-scroll',
                                'settings.scroll',
                                DEFAULT_ENGAGEMENT_SETTINGS.minScrollPercent
                            )}
                            {numberField(
                                'minReadSeconds',
                                'eng-read',
                                'settings.dwell',
                                DEFAULT_ENGAGEMENT_SETTINGS.minReadSeconds
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">{t('settings.gamesTitle')}</CardTitle>
                            <CardDescription>{t('settings.gamesHint')}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-4 sm:grid-cols-2">
                                {numberField(
                                    'minGameSeconds',
                                    'eng-game',
                                    'settings.minGameSeconds',
                                    DEFAULT_ENGAGEMENT_SETTINGS.minGameSeconds
                                )}
                            </div>
                            <div className="flex items-center gap-3">
                                <Switch
                                    id="eng-unverified"
                                    checked={form.allowUnverifiedScoreBonus}
                                    onCheckedChange={(v) => patch({ allowUnverifiedScoreBonus: v })}
                                />
                                <Label htmlFor="eng-unverified">{t('settings.unverified')}</Label>
                            </div>
                        </CardContent>
                    </Card>
                </>
            )}
        </div>
    );
}
