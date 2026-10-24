import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useAIModelsList } from '@/hooks/useAiModels';
import { AI_SERVICE_BASE_URL } from '@/constants/urls';
import { LANGUAGES } from '@/routes/video-api-studio/-services/video-generation';
import { VideoCamera } from '@phosphor-icons/react';

// Languages grouped for the dropdown, matching the voice endpoint's keys.
const LANGUAGE_GROUPS: Array<{ group: string; items: Array<{ value: string; label: string }> }> =
    LANGUAGES.reduce(
        (acc, lang) => {
            const existing = acc.find((g) => g.group === lang.group);
            const item = { value: lang.value, label: lang.label };
            if (existing) existing.items.push(item);
            else acc.push({ group: lang.group, items: [item] });
            return acc;
        },
        [] as Array<{ group: string; items: Array<{ value: string; label: string }> }>
    );

/**
 * Course-level AI-video settings, applied to every AI Video / AI Slides /
 * AI Storybook page of the generated course. Sent to the backend as the
 * content request's `video_settings` (snake_case keys) where they are
 * injected into each video todo's metadata.
 */
export interface AiVideoSettings {
    model: string; // 'auto' → let the backend registry pick
    language: string; // video-narration language, e.g. 'English (India)', 'Hindi'
    voiceGender: 'female' | 'male';
    ttsProvider: 'standard' | 'premium';
    voiceId: string; // '' → auto-pick by language + gender
    targetDuration: string;
    qualityTier: string;
}

export const DEFAULT_AI_VIDEO_SETTINGS: AiVideoSettings = {
    model: 'auto',
    language: 'English (US)',
    voiceGender: 'female',
    ttsProvider: 'standard',
    voiceId: '',
    targetDuration: '2-3 minutes',
    qualityTier: 'ultra',
};

/** Map wizard settings to the backend `video_settings` payload (omit autos). */
export function toVideoSettingsPayload(
    settings: AiVideoSettings | undefined
): Record<string, string> {
    if (!settings) return {};
    const payload: Record<string, string> = {
        language: settings.language,
        voice_gender: settings.voiceGender,
        tts_provider: settings.ttsProvider,
        quality_tier: settings.qualityTier,
        target_duration: settings.targetDuration,
    };
    if (settings.model && settings.model !== 'auto') payload.model = settings.model;
    if (settings.voiceId) payload.voice_id = settings.voiceId;
    return payload;
}

interface TtsVoice {
    id: string;
    name: string;
    provider: string;
    sample_url: string;
}

async function fetchVoices(
    language: string,
    gender: string,
    tier: string
): Promise<{ voices: TtsVoice[] }> {
    // Bare "English" isn't a voice-endpoint key (it wants a region like
    // "English (US)"); normalize so the premium list doesn't degrade to a
    // single Edge voice the Google TTS path can't play.
    const normalizedLanguage =
        language.trim().toLowerCase() === 'english' ? 'English (US)' : language;
    const params = new URLSearchParams({ language: normalizedLanguage, gender, tier });
    const resp = await fetch(`${AI_SERVICE_BASE_URL}/external/video/v1/tts/voices?${params}`);
    if (!resp.ok) throw new Error(`Failed to fetch voices: ${resp.status}`);
    return resp.json();
}

// Canonical values persisted in AiVideoSettings/the backend payload; kept in
// English regardless of locale. Labels shown to the user are localized below.
const DURATIONS = ['1-2 minutes', '2-3 minutes', '3-5 minutes', '5-8 minutes'] as const;
const DURATION_LABEL_KEYS: Record<(typeof DURATIONS)[number], string> = {
    '1-2 minutes': 'durationLabel.oneToTwoMinutes',
    '2-3 minutes': 'durationLabel.twoToThreeMinutes',
    '3-5 minutes': 'durationLabel.threeToFiveMinutes',
    '5-8 minutes': 'durationLabel.fiveToEightMinutes',
};

const buildDurationOptions = (t: TFunction) =>
    DURATIONS.map((value) => ({
        value,
        label: t(DURATION_LABEL_KEYS[value]),
    }));

const buildQualityTiers = (t: TFunction) => [
    { value: 'free', label: t('qualityTier.free') },
    { value: 'standard', label: t('qualityTier.standard') },
    { value: 'premium', label: t('qualityTier.premium') },
    { value: 'ultra', label: t('qualityTier.ultra') },
];

interface AiVideoSettingsCardProps {
    value: AiVideoSettings;
    onChange: (value: AiVideoSettings) => void;
}

export function AiVideoSettingsCard({ value, onChange }: AiVideoSettingsCardProps) {
    const { t } = useTranslation('studyLibraryAiVideoSettingsCard');
    const { data: modelsList, isLoading: modelsLoading } = useAIModelsList({ use_case: 'video' });
    const { data: voicesData, isLoading: voicesLoading } = useQuery({
        queryKey: ['tts-voices', value.language, value.voiceGender, value.ttsProvider],
        queryFn: () => fetchVoices(value.language, value.voiceGender, value.ttsProvider),
        staleTime: 1000 * 60 * 10,
    });

    const set = (patch: Partial<AiVideoSettings>) => onChange({ ...value, ...patch });
    const qualityTiers = buildQualityTiers(t);
    const durationOptions = buildDurationOptions(t);

    return (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
                <VideoCamera className="size-4 shrink-0 text-neutral-500" />
                <span className="text-sm font-semibold text-neutral-900">{t('title')}</span>
                <span className="text-xs text-neutral-500">
                    {t('appliesTo')}
                </span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                    <Label className="mb-1 block text-xs text-neutral-600">{t('language')}</Label>
                    <Select
                        value={value.language}
                        onValueChange={(v) => set({ language: v, voiceId: '' })}
                    >
                        <SelectTrigger className="h-9 bg-white text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="max-h-72">
                            {LANGUAGE_GROUPS.map((grp) => (
                                <SelectGroup key={grp.group}>
                                    <SelectLabel>{grp.group}</SelectLabel>
                                    {grp.items.map((lang) => (
                                        <SelectItem key={lang.value} value={lang.value}>
                                            {lang.label}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div>
                    <Label className="mb-1 block text-xs text-neutral-600">{t('videoModel')}</Label>
                    <Select value={value.model} onValueChange={(v) => set({ model: v })}>
                        <SelectTrigger className="h-9 bg-white text-xs">
                            <SelectValue placeholder={t('autoRecommended')} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="auto">{t('autoRecommended')}</SelectItem>
                            {modelsLoading ? (
                                <div className="px-2 py-1.5 text-xs text-neutral-500">
                                    {t('loading')}
                                </div>
                            ) : (
                                modelsList?.models.map((model) => (
                                    <SelectItem key={model.model_id} value={model.model_id}>
                                        {model.name}
                                    </SelectItem>
                                ))
                            )}
                        </SelectContent>
                    </Select>
                </div>
                <div>
                    <Label className="mb-1 block text-xs text-neutral-600">{t('audioQuality')}</Label>
                    <Select
                        value={value.ttsProvider}
                        onValueChange={(v) =>
                            set({ ttsProvider: v as AiVideoSettings['ttsProvider'], voiceId: '' })
                        }
                    >
                        <SelectTrigger className="h-9 bg-white text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="standard">{t('audioQualityStandard')}</SelectItem>
                            <SelectItem value="premium">{t('audioQualityPremium')}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div>
                    <Label className="mb-1 block text-xs text-neutral-600">{t('voiceGender')}</Label>
                    <Select
                        value={value.voiceGender}
                        onValueChange={(v) =>
                            set({ voiceGender: v as AiVideoSettings['voiceGender'], voiceId: '' })
                        }
                    >
                        <SelectTrigger className="h-9 bg-white text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="female">{t('genderFemale')}</SelectItem>
                            <SelectItem value="male">{t('genderMale')}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div>
                    <Label className="mb-1 block text-xs text-neutral-600">{t('voice')}</Label>
                    <Select
                        value={value.voiceId || 'auto'}
                        onValueChange={(v) => set({ voiceId: v === 'auto' ? '' : v })}
                    >
                        <SelectTrigger className="h-9 bg-white text-xs">
                            <SelectValue placeholder={t('auto')} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="auto">{t('autoBestForLanguage')}</SelectItem>
                            {voicesLoading ? (
                                <div className="px-2 py-1.5 text-xs text-neutral-500">
                                    {t('loading')}
                                </div>
                            ) : (
                                voicesData?.voices.map((voice) => (
                                    <SelectItem key={voice.id} value={voice.id}>
                                        {voice.name}
                                    </SelectItem>
                                ))
                            )}
                        </SelectContent>
                    </Select>
                </div>
                <div>
                    <Label className="mb-1 block text-xs text-neutral-600">{t('videoDuration')}</Label>
                    <Select
                        value={value.targetDuration}
                        onValueChange={(v) => set({ targetDuration: v })}
                    >
                        <SelectTrigger className="h-9 bg-white text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {durationOptions.map((duration) => (
                                <SelectItem key={duration.value} value={duration.value}>
                                    {duration.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div>
                    <Label className="mb-1 block text-xs text-neutral-600">{t('qualityTierLabel')}</Label>
                    <Select
                        value={value.qualityTier}
                        onValueChange={(v) => set({ qualityTier: v })}
                    >
                        <SelectTrigger className="h-9 bg-white text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {qualityTiers.map((tier) => (
                                <SelectItem key={tier.value} value={tier.value}>
                                    {tier.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>
        </div>
    );
}
