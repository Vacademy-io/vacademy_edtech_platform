import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import i18next from 'i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { MyButton } from '@/components/design-system/button';
import { Plus, Trash } from '@phosphor-icons/react';
import { toast } from 'sonner';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

// ─── Types (mirror admin-core CrmIntelligenceSettingsPojo) ─────────────────────
// Stored under the institute's CRM_INTELLIGENCE_SETTING JSON. Gates which call
// recordings get transcribed + AI-analyzed, and tunes how the two ratings score.

type CallSource = 'MANUAL' | 'TELEPHONY' | 'AI';

/** One rated metric: the term the AI scores + a plain-English meaning that
 *  guides how it's graded (sent to the analysis prompt). */
interface RubricQuality {
    key: string;
    description?: string;
}

interface RubricSettings {
    objectiveHint: string | null;
    qualities: RubricQuality[];
    weights?: Record<string, number> | null;
}

interface CallsSettings {
    enabled: boolean;
    sources: Record<CallSource, boolean>;
    minDurationSeconds: number;
    analyzeNotConnected: boolean;
    ratingScale: number;
    rubric: RubricSettings;
}

interface CrmIntelligenceSettingsData {
    enabled: boolean;
    calls: CallsSettings;
}

const DEFAULT_QUALITY_KEYS = [
    'rapport',
    'needs_discovery',
    'objection_handling',
    'next_step_secured',
] as const;

// The set of rubric quality keys that have a built-in, well-known definition
// (see the settingsCrmIntelligence:qualityDescriptions catalog). Custom
// qualities an institute adds simply won't match here — that's fine, the term
// itself still guides the AI. These are internal identifiers (also the literal
// value sent to the AI as the metric name), not display text, so they stay
// hardcoded rather than translated.
const KNOWN_QUALITY_KEYS = new Set<string>([
    'rapport',
    'needs_discovery',
    'objection_handling',
    'next_step_secured',
    'value_articulation',
    'pitch_clarity',
    'active_listening',
    'urgency_creation',
    'closing',
    'talk_listen_balance',
    'follow_up_commitment',
    'tone_confidence',
]);

/**
 * Plain-English, sales-team definition for a rubric quality — shown under each
 * field so admins know exactly what the AI grades. Looked up by the normalized
 * quality (lowercase, spaces → underscores) against the known set above.
 *
 * Called both from inside the component (JSX) and from plain module-scope
 * helpers (normalizeQualities, getDefaultRubric) that have no hooks available,
 * so it goes through the i18next singleton rather than a passed-in `t`.
 * Resolved lazily on every call (not memoized) so it always reflects the
 * active language.
 */
const qualityDescription = (q: string): string | undefined => {
    const key = q.trim().toLowerCase().replace(/\s+/g, '_');
    return KNOWN_QUALITY_KEYS.has(key)
        ? i18next.t(`settingsCrmIntelligence:qualityDescriptions.${key}`)
        : undefined;
};

/**
 * Accept both the legacy shape (qualities: string[]) and the current one
 * (qualities: {key, description}[]) so saved settings keep working. Strings get
 * the built-in description for known terms.
 */
function normalizeQualities(raw: unknown): RubricQuality[] {
    if (!Array.isArray(raw)) return getDefaultRubric().qualities;
    return raw
        .map((q): RubricQuality | null => {
            if (typeof q === 'string') return { key: q, description: qualityDescription(q) };
            if (q && typeof q === 'object' && 'key' in q) {
                const o = q as { key?: unknown; description?: unknown };
                const key = String(o.key ?? '').trim();
                if (!key) return null;
                return {
                    key,
                    description:
                        typeof o.description === 'string' && o.description.trim()
                            ? o.description
                            : qualityDescription(key),
                };
            }
            return null;
        })
        .filter((q): q is RubricQuality => q != null);
}

// Resolved lazily (not memoized) so the rubric description text always
// reflects the active language — mirrors qualityDescription() above.
function getDefaultRubric(): RubricSettings {
    return {
        objectiveHint: null,
        qualities: DEFAULT_QUALITY_KEYS.map((key) => ({
            key,
            description: qualityDescription(key),
        })),
        weights: null,
    };
}

function getDefaultCalls(): CallsSettings {
    return {
        enabled: false,
        sources: { MANUAL: true, TELEPHONY: true, AI: true },
        minDurationSeconds: 20,
        analyzeNotConnected: false,
        ratingScale: 10,
        rubric: getDefaultRubric(),
    };
}

function getDefaultSettings(): CrmIntelligenceSettingsData {
    return {
        enabled: false,
        calls: getDefaultCalls(),
    };
}

function buildSourceLabels(t: TFunction): { key: CallSource; label: string; help: string }[] {
    return [
        {
            key: 'MANUAL',
            label: t('callAnalysis.sources.manual.label'),
            help: t('callAnalysis.sources.manual.help'),
        },
        {
            key: 'TELEPHONY',
            label: t('callAnalysis.sources.telephony.label'),
            help: t('callAnalysis.sources.telephony.help'),
        },
        {
            key: 'AI',
            label: t('callAnalysis.sources.ai.label'),
            help: t('callAnalysis.sources.ai.help'),
        },
    ];
}

const SETTING_KEY = 'CRM_INTELLIGENCE_SETTING';
const GET_URL = `${BASE_URL}/admin-core-service/institute/setting/v1/get`;
const SAVE_URL = `${BASE_URL}/admin-core-service/institute/setting/v1/save-setting`;

const fetchSettings = async (): Promise<CrmIntelligenceSettingsData> => {
    const instituteId = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_URL,
        params: { instituteId, settingKey: SETTING_KEY },
    });
    const saved = response.data?.data as Partial<CrmIntelligenceSettingsData> | undefined;
    const defaultSettings = getDefaultSettings();
    if (!saved) return defaultSettings;
    const defaultCalls = getDefaultCalls();
    const defaultRubric = getDefaultRubric();
    // Deep-merge the calls + rubric blocks so a partial saved doc keeps defaults.
    return {
        ...defaultSettings,
        ...saved,
        calls: {
            ...defaultCalls,
            ...(saved.calls ?? {}),
            sources: { ...defaultCalls.sources, ...(saved.calls?.sources ?? {}) },
            rubric: {
                ...defaultRubric,
                ...(saved.calls?.rubric ?? {}),
                // Coerce legacy string[] → {key, description}[].
                qualities: normalizeQualities(saved.calls?.rubric?.qualities),
            },
        },
    };
};

const saveSettings = async (data: CrmIntelligenceSettingsData): Promise<void> => {
    const instituteId = getCurrentInstituteId();
    await authenticatedAxiosInstance.post(
        SAVE_URL,
        { setting_name: 'CRM Intelligence Settings', setting_data: data },
        { params: { instituteId, settingKey: SETTING_KEY } }
    );
};

export default function CrmIntelligenceSettings() {
    const { t } = useTranslation('settingsCrmIntelligence');
    const queryClient = useQueryClient();
    const [settings, setSettings] = useState<CrmIntelligenceSettingsData>(getDefaultSettings());
    const [hasChanges, setHasChanges] = useState(false);
    const sourceLabels = buildSourceLabels(t);

    const { data, isLoading } = useQuery({
        queryKey: ['crm-intelligence-settings'],
        queryFn: fetchSettings,
        staleTime: 5 * 60 * 1000,
    });

    useEffect(() => {
        if (data) {
            setSettings(data);
            setHasChanges(false);
        }
    }, [data]);

    const { mutate: save, isPending: saving } = useMutation({
        mutationFn: saveSettings,
        onSuccess: () => {
            toast.success(t('toasts.saveSuccess'));
            setHasChanges(false);
            queryClient.invalidateQueries({ queryKey: ['crm-intelligence-settings'] });
        },
        onError: () => toast.error(t('toasts.saveFailed')),
    });

    const update = (patch: Partial<CrmIntelligenceSettingsData>) => {
        setSettings((prev) => ({ ...prev, ...patch }));
        setHasChanges(true);
    };
    const updateCalls = (patch: Partial<CallsSettings>) => {
        setSettings((prev) => ({ ...prev, calls: { ...prev.calls, ...patch } }));
        setHasChanges(true);
    };
    const updateRubric = (patch: Partial<RubricSettings>) => {
        setSettings((prev) => ({
            ...prev,
            calls: { ...prev.calls, rubric: { ...prev.calls.rubric, ...patch } },
        }));
        setHasChanges(true);
    };

    const toggleSource = (key: CallSource, on: boolean) =>
        updateCalls({ sources: { ...settings.calls.sources, [key]: on } });

    const setQualityKey = (i: number, key: string) =>
        updateRubric({
            qualities: settings.calls.rubric.qualities.map((q, idx) =>
                idx === i ? { ...q, key } : q
            ),
        });
    const setQualityDescription = (i: number, description: string) =>
        updateRubric({
            qualities: settings.calls.rubric.qualities.map((q, idx) =>
                idx === i ? { ...q, description } : q
            ),
        });
    const addQuality = () =>
        updateRubric({
            qualities: [...settings.calls.rubric.qualities, { key: '', description: '' }],
        });
    const removeQuality = (i: number) =>
        updateRubric({ qualities: settings.calls.rubric.qualities.filter((_, idx) => idx !== i) });

    const handleSave = () => {
        // Trim, drop unnamed metrics, and keep each metric's meaning alongside it.
        const cleaned: CrmIntelligenceSettingsData = {
            ...settings,
            calls: {
                ...settings.calls,
                rubric: {
                    ...settings.calls.rubric,
                    objectiveHint: settings.calls.rubric.objectiveHint?.trim() || null,
                    qualities: settings.calls.rubric.qualities
                        .map((q) => ({
                            key: q.key.trim(),
                            description: q.description?.trim() || undefined,
                        }))
                        .filter((q) => q.key.length > 0),
                },
            },
        };
        save(cleaned);
    };

    return (
        <div className="space-y-6 p-6">
            <Card>
                <CardHeader>
                    <CardTitle>{t('header.title')}</CardTitle>
                    <CardDescription>{t('header.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-center gap-3">
                        <Switch
                            id="crm-intel-enabled"
                            checked={settings.enabled}
                            onCheckedChange={(v) => update({ enabled: v })}
                        />
                        <Label htmlFor="crm-intel-enabled" className="cursor-pointer">
                            {settings.enabled ? t('status.enabled') : t('status.disabled')}
                        </Label>
                    </div>
                </CardContent>
            </Card>

            {settings.enabled && (
                <>
                    <Card>
                        <CardHeader>
                            <CardTitle>{t('callAnalysis.title')}</CardTitle>
                            <CardDescription>{t('callAnalysis.description')}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center gap-3">
                                <Switch
                                    id="calls-enabled"
                                    checked={settings.calls.enabled}
                                    onCheckedChange={(v) => updateCalls({ enabled: v })}
                                />
                                <Label htmlFor="calls-enabled" className="cursor-pointer">
                                    {t('callAnalysis.analyzeRecordings')}
                                </Label>
                            </div>

                            {settings.calls.enabled && (
                                <>
                                    <Separator />
                                    <div className="space-y-3">
                                        <Label>{t('callAnalysis.sourcesLabel')}</Label>
                                        {sourceLabels.map((s) => (
                                            <div key={s.key} className="flex items-start gap-3">
                                                <Switch
                                                    id={`src-${s.key}`}
                                                    checked={settings.calls.sources[s.key]}
                                                    onCheckedChange={(v) => toggleSource(s.key, v)}
                                                />
                                                <div className="grid gap-0.5">
                                                    <Label
                                                        htmlFor={`src-${s.key}`}
                                                        className="cursor-pointer"
                                                    >
                                                        {s.label}
                                                    </Label>
                                                    <p className="text-caption text-muted-foreground">
                                                        {s.help}
                                                    </p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    <Separator />

                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                        <div className="grid gap-2">
                                            <Label htmlFor="min-duration">
                                                {t('callAnalysis.minDuration.label')}
                                            </Label>
                                            <Input
                                                id="min-duration"
                                                type="number"
                                                min={0}
                                                max={600}
                                                value={settings.calls.minDurationSeconds}
                                                onChange={(e) =>
                                                    updateCalls({
                                                        minDurationSeconds:
                                                            parseInt(e.target.value, 10) || 0,
                                                    })
                                                }
                                                className="w-28"
                                            />
                                            <p className="text-caption text-muted-foreground">
                                                {t('callAnalysis.minDuration.hint')}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-3">
                                        <Switch
                                            id="analyze-not-connected"
                                            checked={settings.calls.analyzeNotConnected}
                                            onCheckedChange={(v) =>
                                                updateCalls({ analyzeNotConnected: v })
                                            }
                                        />
                                        <Label
                                            htmlFor="analyze-not-connected"
                                            className="cursor-pointer"
                                        >
                                            {t('callAnalysis.analyzeNotConnected')}
                                        </Label>
                                    </div>
                                </>
                            )}
                        </CardContent>
                    </Card>

                    {settings.calls.enabled && (
                        <Card>
                            <CardHeader>
                                <CardTitle>{t('rubric.title')}</CardTitle>
                                <CardDescription>{t('rubric.description')}</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid max-w-xl gap-2">
                                    <Label htmlFor="objective-hint">
                                        {t('rubric.objectiveHint.label')}
                                    </Label>
                                    <Input
                                        id="objective-hint"
                                        value={settings.calls.rubric.objectiveHint ?? ''}
                                        placeholder={t('rubric.objectiveHint.placeholder')}
                                        onChange={(e) =>
                                            updateRubric({ objectiveHint: e.target.value })
                                        }
                                    />
                                </div>

                                <div className="space-y-4">
                                    <div className="grid gap-0.5">
                                        <Label>{t('rubric.ratedMetrics.label')}</Label>
                                        <p className="text-caption text-muted-foreground">
                                            <Trans i18nKey="settingsCrmIntelligence:rubric.ratedMetrics.description"><span className="font-medium">meaning</span></Trans>
                                        </p>
                                    </div>
                                    {settings.calls.rubric.qualities.map((q, i) => (
                                        <div
                                            key={i}
                                            className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3"
                                        >
                                            <div className="flex items-center gap-2">
                                                <Input
                                                    value={q.key}
                                                    placeholder={t('rubric.metric.keyPlaceholder')}
                                                    onChange={(e) =>
                                                        setQualityKey(i, e.target.value)
                                                    }
                                                    className="max-w-md flex-1"
                                                />
                                                <MyButton
                                                    buttonType="secondary"
                                                    scale="medium"
                                                    onClick={() => removeQuality(i)}
                                                >
                                                    <Trash className="size-4" />
                                                </MyButton>
                                            </div>
                                            <Input
                                                value={q.description ?? ''}
                                                placeholder={
                                                    qualityDescription(q.key) ??
                                                    t('rubric.metric.descriptionFallbackPlaceholder')
                                                }
                                                onChange={(e) =>
                                                    setQualityDescription(i, e.target.value)
                                                }
                                                className="text-caption"
                                            />
                                        </div>
                                    ))}
                                    <MyButton
                                        buttonType="secondary"
                                        scale="medium"
                                        onClick={addQuality}
                                    >
                                        <Plus className="size-4" /> {t('rubric.addMetric')}
                                    </MyButton>
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </>
            )}

            <div className="flex items-center justify-end">
                <MyButton
                    buttonType="primary"
                    scale="medium"
                    onClick={handleSave}
                    disable={saving || !hasChanges || isLoading}
                >
                    {saving ? t('save.saving') : t('save.button')}
                </MyButton>
            </div>
        </div>
    );
}
