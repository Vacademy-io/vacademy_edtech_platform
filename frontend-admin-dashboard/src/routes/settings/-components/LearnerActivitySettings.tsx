import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { MyButton } from '@/components/design-system/button';
import { toast } from 'sonner';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_INSITITUTE_SETTINGS } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

// ─── Types ───────────────────────────────────────────────────────────────────
// Mirrors frontend-learner-dashboard-app/src/services/learner-tracking-settings.ts.
// The learner app deep-merges whatever is stored here over the same defaults,
// so partial/older blobs stay safe.

interface LearnerActivitySettingsData {
    completion: {
        slideCompletionThresholdPercent: number;
    };
    documents: {
        pageDwellSeconds: number;
        actionDwellSeconds: number;
        readingTime: {
            enabled: boolean;
            wordsPerMinute: number;
            minSeconds: number;
            maxSeconds: number;
        };
    };
    focus: {
        idlePopupEnabled: boolean;
        idlePopupDelaySeconds: number;
        hardPauseMinutes: number;
    };
}

const DEFAULT_SETTINGS: LearnerActivitySettingsData = {
    completion: {
        slideCompletionThresholdPercent: 80,
    },
    documents: {
        pageDwellSeconds: 10,
        actionDwellSeconds: 5,
        readingTime: {
            enabled: true,
            wordsPerMinute: 200,
            minSeconds: 10,
            maxSeconds: 600,
        },
    },
    focus: {
        idlePopupEnabled: true,
        idlePopupDelaySeconds: 60,
        hardPauseMinutes: 5,
    },
};

const SETTING_KEY = 'LEARNER_TRACKING_SETTING';
const SAVE_URL = GET_INSITITUTE_SETTINGS.replace('/get', '/save-setting');

// ─── API ─────────────────────────────────────────────────────────────────────

const mergeWithDefaults = (
    partial: Partial<LearnerActivitySettingsData> | null | undefined
): LearnerActivitySettingsData => ({
    completion: { ...DEFAULT_SETTINGS.completion, ...partial?.completion },
    documents: {
        ...DEFAULT_SETTINGS.documents,
        ...partial?.documents,
        readingTime: {
            ...DEFAULT_SETTINGS.documents.readingTime,
            ...partial?.documents?.readingTime,
        },
    },
    focus: { ...DEFAULT_SETTINGS.focus, ...partial?.focus },
});

const fetchSettings = async (): Promise<LearnerActivitySettingsData> => {
    const instituteId = getCurrentInstituteId();
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_INSITITUTE_SETTINGS,
        params: { instituteId, settingKey: SETTING_KEY },
    });
    return mergeWithDefaults(response.data?.data);
};

const saveSettings = async (data: LearnerActivitySettingsData): Promise<void> => {
    const instituteId = getCurrentInstituteId();
    await authenticatedAxiosInstance.post(
        SAVE_URL,
        { setting_name: 'Learner Activity Settings', setting_data: data },
        { params: { instituteId, settingKey: SETTING_KEY } }
    );
};

// ─── Small helpers ───────────────────────────────────────────────────────────

interface NumberFieldProps {
    id: string;
    label: string;
    value: number;
    min: number;
    max: number;
    suffix?: string;
    help: string;
    disabled?: boolean;
    onChange: (value: number) => void;
}

function NumberField({
    id,
    label,
    value,
    min,
    max,
    suffix,
    help,
    disabled,
    onChange,
}: NumberFieldProps) {
    return (
        <div className="space-y-1.5">
            <Label htmlFor={id}>{label}</Label>
            <div className="flex items-center gap-2">
                <Input
                    id={id}
                    type="number"
                    min={min}
                    max={max}
                    value={value}
                    disabled={disabled}
                    onChange={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n)) onChange(n);
                    }}
                    className="max-w-28"
                />
                {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
            </div>
            <p className="text-xs text-muted-foreground">{help}</p>
        </div>
    );
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

// ─── Component ───────────────────────────────────────────────────────────────

export default function LearnerActivitySettings() {
    const { t } = useTranslation('settingsLearnerActivity');
    const queryClient = useQueryClient();
    const [settings, setSettings] = useState<LearnerActivitySettingsData>(DEFAULT_SETTINGS);
    const [hasChanges, setHasChanges] = useState(false);
    const learnerLabel = getTerminology(RoleTerms.Learner, SystemTerms.Learner);
    const slideLabel = getTerminology(ContentTerms.Slide, SystemTerms.Slide);

    const { data, isLoading, isError } = useQuery({
        queryKey: ['learner-activity-settings'],
        queryFn: fetchSettings,
        staleTime: 5 * 60 * 1000,
    });

    useEffect(() => {
        if (data) {
            setSettings(data);
            setHasChanges(false);
        }
    }, [data]);

    const update = (
        updater: (prev: LearnerActivitySettingsData) => LearnerActivitySettingsData
    ) => {
        setSettings(updater);
        setHasChanges(true);
    };

    const { mutate: save, isPending: saving } = useMutation({
        mutationFn: saveSettings,
        onSuccess: () => {
            toast.success(t('toasts.saveSuccess'));
            setHasChanges(false);
            queryClient.invalidateQueries({ queryKey: ['learner-activity-settings'] });
        },
        onError: () => {
            toast.error(t('toasts.saveFailed'));
        },
    });

    const handleSave = () => {
        // Clamp to the same bounds the learner app enforces so what admins
        // see is what learners get.
        const s = settings;
        save({
            completion: {
                slideCompletionThresholdPercent: clamp(
                    s.completion.slideCompletionThresholdPercent,
                    1,
                    100
                ),
            },
            documents: {
                pageDwellSeconds: clamp(s.documents.pageDwellSeconds, 1, 600),
                actionDwellSeconds: clamp(s.documents.actionDwellSeconds, 1, 600),
                readingTime: {
                    enabled: s.documents.readingTime.enabled,
                    wordsPerMinute: clamp(s.documents.readingTime.wordsPerMinute, 50, 1000),
                    minSeconds: clamp(s.documents.readingTime.minSeconds, 1, 3600),
                    maxSeconds: clamp(
                        Math.max(
                            s.documents.readingTime.maxSeconds,
                            s.documents.readingTime.minSeconds
                        ),
                        10,
                        7200
                    ),
                },
            },
            focus: {
                idlePopupEnabled: s.focus.idlePopupEnabled,
                idlePopupDelaySeconds: clamp(s.focus.idlePopupDelaySeconds, 10, 3600),
                hardPauseMinutes: clamp(s.focus.hardPauseMinutes, 1, 120),
            },
        });
    };

    if (isLoading) {
        return (
            <div className="p-6 text-sm text-muted-foreground">{t('states.loading')}</div>
        );
    }
    if (isError) {
        return (
            <div className="p-6 text-sm text-muted-foreground">{t('states.error')}</div>
        );
    }

    return (
        <div className="space-y-6 p-6">
            <Card>
                <CardHeader>
                    <CardTitle>{t('completion.title')}</CardTitle>
                    <CardDescription>
                        {t('completion.description', {
                            slide: slideLabel.toLowerCase(),
                            learner: learnerLabel.toLowerCase(),
                        })}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <NumberField
                        id="completion-threshold"
                        label={t('completion.thresholdField.label')}
                        value={settings.completion.slideCompletionThresholdPercent}
                        min={1}
                        max={100}
                        suffix={t('completion.thresholdField.suffix')}
                        help={t('completion.thresholdField.help')}
                        onChange={(v) =>
                            update((p) => ({
                                ...p,
                                completion: { ...p.completion, slideCompletionThresholdPercent: v },
                            }))
                        }
                    />
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>{t('reading.title')}</CardTitle>
                    <CardDescription>
                        {t('reading.description', { learner: learnerLabel.toLowerCase() })}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <NumberField
                        id="page-dwell"
                        label={t('reading.pageDwell.label')}
                        value={settings.documents.pageDwellSeconds}
                        min={1}
                        max={600}
                        suffix={t('reading.pageDwell.suffix')}
                        help={t('reading.pageDwell.help')}
                        onChange={(v) =>
                            update((p) => ({
                                ...p,
                                documents: { ...p.documents, pageDwellSeconds: v },
                            }))
                        }
                    />
                    <NumberField
                        id="action-dwell"
                        label={t('reading.actionDwell.label')}
                        value={settings.documents.actionDwellSeconds}
                        min={1}
                        max={600}
                        suffix={t('reading.actionDwell.suffix')}
                        help={t('reading.actionDwell.help')}
                        onChange={(v) =>
                            update((p) => ({
                                ...p,
                                documents: { ...p.documents, actionDwellSeconds: v },
                            }))
                        }
                    />

                    <div className="space-y-4 rounded-lg border p-4">
                        <div className="flex items-center gap-3">
                            <Switch
                                id="reading-time-enabled"
                                checked={settings.documents.readingTime.enabled}
                                onCheckedChange={(v) =>
                                    update((p) => ({
                                        ...p,
                                        documents: {
                                            ...p.documents,
                                            readingTime: { ...p.documents.readingTime, enabled: v },
                                        },
                                    }))
                                }
                            />
                            <div>
                                <Label htmlFor="reading-time-enabled" className="cursor-pointer">
                                    {t('reading.readingTimeToggle.label')}
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                    {t('reading.readingTimeToggle.help')}
                                </p>
                            </div>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-3">
                            <NumberField
                                id="reading-wpm"
                                label={t('reading.wpm.label')}
                                value={settings.documents.readingTime.wordsPerMinute}
                                min={50}
                                max={1000}
                                suffix={t('reading.wpm.suffix')}
                                disabled={!settings.documents.readingTime.enabled}
                                help={t('reading.wpm.help')}
                                onChange={(v) =>
                                    update((p) => ({
                                        ...p,
                                        documents: {
                                            ...p.documents,
                                            readingTime: {
                                                ...p.documents.readingTime,
                                                wordsPerMinute: v,
                                            },
                                        },
                                    }))
                                }
                            />
                            <NumberField
                                id="reading-min"
                                label={t('reading.minSeconds.label')}
                                value={settings.documents.readingTime.minSeconds}
                                min={1}
                                max={3600}
                                suffix={t('reading.minSeconds.suffix')}
                                disabled={!settings.documents.readingTime.enabled}
                                help={t('reading.minSeconds.help')}
                                onChange={(v) =>
                                    update((p) => ({
                                        ...p,
                                        documents: {
                                            ...p.documents,
                                            readingTime: {
                                                ...p.documents.readingTime,
                                                minSeconds: v,
                                            },
                                        },
                                    }))
                                }
                            />
                            <NumberField
                                id="reading-max"
                                label={t('reading.maxSeconds.label')}
                                value={settings.documents.readingTime.maxSeconds}
                                min={10}
                                max={7200}
                                suffix={t('reading.maxSeconds.suffix')}
                                disabled={!settings.documents.readingTime.enabled}
                                help={t('reading.maxSeconds.help')}
                                onChange={(v) =>
                                    update((p) => ({
                                        ...p,
                                        documents: {
                                            ...p.documents,
                                            readingTime: {
                                                ...p.documents.readingTime,
                                                maxSeconds: v,
                                            },
                                        },
                                    }))
                                }
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>{t('focus.title')}</CardTitle>
                    <CardDescription>{t('focus.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="flex items-center gap-3">
                        <Switch
                            id="idle-popup-enabled"
                            checked={settings.focus.idlePopupEnabled}
                            onCheckedChange={(v) =>
                                update((p) => ({
                                    ...p,
                                    focus: { ...p.focus, idlePopupEnabled: v },
                                }))
                            }
                        />
                        <div>
                            <Label htmlFor="idle-popup-enabled" className="cursor-pointer">
                                {t('focus.idlePopupToggle.label')}
                            </Label>
                            <p className="text-xs text-muted-foreground">
                                {t('focus.idlePopupToggle.help')}
                            </p>
                        </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <NumberField
                            id="idle-delay"
                            label={t('focus.idleDelay.label')}
                            value={settings.focus.idlePopupDelaySeconds}
                            min={10}
                            max={3600}
                            suffix={t('focus.idleDelay.suffix')}
                            disabled={!settings.focus.idlePopupEnabled}
                            help={t('focus.idleDelay.help')}
                            onChange={(v) =>
                                update((p) => ({
                                    ...p,
                                    focus: { ...p.focus, idlePopupDelaySeconds: v },
                                }))
                            }
                        />
                        <NumberField
                            id="hard-pause"
                            label={t('focus.hardPause.label')}
                            value={settings.focus.hardPauseMinutes}
                            min={1}
                            max={120}
                            suffix={t('focus.hardPause.suffix')}
                            help={t('focus.hardPause.help')}
                            onChange={(v) =>
                                update((p) => ({
                                    ...p,
                                    focus: { ...p.focus, hardPauseMinutes: v },
                                }))
                            }
                        />
                    </div>
                </CardContent>
            </Card>

            <div className="flex justify-end">
                <MyButton
                    buttonType="primary"
                    scale="medium"
                    onClick={handleSave}
                    disable={saving || !hasChanges}
                >
                    {saving ? t('footer.saving') : t('footer.save')}
                </MyButton>
            </div>
        </div>
    );
}
