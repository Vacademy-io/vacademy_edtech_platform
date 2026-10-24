import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ColorPicker } from '@/components/ui/color-picker';
import {
    GearSix as Settings2,
    Stack as Layers,
    Monitor,
    DeviceMobile as Smartphone,
    Clock,
    Users,
    Globe,
    Microphone as Mic,
    SpeakerHigh as Volume2,
    MagicWand as Wand2,
    ClosedCaptioning as Captions,
    FileText,
    Scissors,
    Palette,
    TextAa as TypeIcon,
    FilmStrip as Film,
    ArrowSquareOut as ExternalLink,
    Play,
    Pause,
    CircleNotch as Loader2,
    Sparkle as SparklesIcon,
    FloppyDisk as Save,
    CaretDown as ChevronDown,
    User as UserIcon,
    UploadSimple as UploadIcon,
    X as XIcon,
    Lock as LockIcon,
    Cpu as CpuIcon,
    CaretRight as ChevronRightIcon,
} from '@phosphor-icons/react';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { useFileUpload } from '@/hooks/use-file-upload';
import { getUserId } from '@/utils/userDetails';
import { Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { getInstituteId } from '@/constants/helper';
import {
    GenerateVideoRequest,
    LANGUAGES,
    ContentType,
    VoiceGender,
    TtsProvider,
    QualityTier,
    VideoOrientation,
    TtsVoice,
    DEFAULT_OPTIONS,
    AvatarModel,
    AvatarQuality,
    HostConfig,
    HostType,
    VisualPreferences,
    FamilyBias,
    TextDensity,
    VisualStyleMode,
    listCasts,
    VideoCast,
    hasActiveVisualPreferences,
    AI_VIDEO_MODELS,
    AiVideoModel,
    ModelOverrides,
    UserOverridableStage,
    BrandOverrides,
    buildContentTypes,
    buildTargetDurationOptions,
    buildQualityTiers,
    buildVoiceGenders,
    buildTtsProviders,
    buildTargetAudienceOptions,
    buildAiVideoModels,
    buildVisualPreferenceFamilies,
    buildAvatarModels,
    buildUserOverridableStageMeta,
} from '../../-services/video-generation';
import { useAIModelsList } from '@/hooks/useAiModels';
import {
    type VideoBrandingConfig,
    type VideoStyleConfig,
    type VideoTemplate,
    type WatermarkPosition,
    FONT_OPTIONS,
    buildWatermarkPositions,
    updateVideoBranding,
    updateVideoStyle,
} from '../../-services/video-style-branding';
import { VimBrandKitSelect } from '@/features/vimotion/composer/VimBrandKitSelect';
import { VimSavedAvatarSelect } from '@/features/vimotion/composer/VimSavedAvatarSelect';
import type {
    StudioAvatar,
    BrandKit,
    BrandPalette,
} from '@/features/vimotion/api/dashboardTypes';
import { useEffectiveCreditRatio } from '@/services/ai-credits/use-credit-rate';
import { formatCredits, usdToCredits } from '../../-utils/credits';
import { LessonModePanel } from './LessonModePanel';
import type { AIModel } from '@/types/ai-models';

interface SettingsPopoverProps {
    options: Omit<GenerateVideoRequest, 'prompt'>;
    onOptionsChange: (options: Omit<GenerateVideoRequest, 'prompt'>) => void;
    /** Institute API key — used by the saved-cast picker's list fetch. */
    apiKey?: string | null;
    reviewModeEnabled?: boolean;
    onReviewModeChange?: (enabled: boolean) => void;
    /** Voice metadata — fetched in Composer; passed in here. */
    availableVoices: TtsVoice[];
    isLoadingVoices: boolean;
    playingVoiceId: string | null;
    onPlayPreview: (voice: TtsVoice) => void;
    /** Institute-wide style + branding. Edited inline; persisted on Save. */
    videoStyle: VideoStyleConfig;
    onVideoStyleChange: React.Dispatch<React.SetStateAction<VideoStyleConfig>>;
    videoBranding: VideoBrandingConfig;
    onVideoBrandingChange: React.Dispatch<React.SetStateAction<VideoBrandingConfig>>;
    videoTemplates: VideoTemplate[];
    /** Curated AI model list for the current content type (use-case). */
    models: AIModel[];
    /**
     * Vim-only mode: swaps the Branding tab's free-form Style/Branding
     * accordions for a saved-Brand-Kit picker (request.brand_kit_id), and
     * the Host tab's face-upload UI for a saved-Avatar picker
     * (host.avatar.saved_avatar_id). Built-in providers (argil/veed) hide
     * the Avatar model + details prompt fields since their endpoints are
     * fixed by provider.
     */
    vimMode?: boolean;
}

/**
 * Settings keys whose divergence from {@link DEFAULT_OPTIONS} we surface as the
 * badge count on the ⚙ trigger. We intentionally **exclude**:
 *  - `model` — legacy top-level field, auto-selected by quality_tier (admin)
 *    or undefined in vimMode. Per-stage overrides are tracked separately
 *    below via `model_overrides`.
 *  - `voice_id` — undefined by default; gets populated automatically when the
 *    voice list loads, which would inflate the badge for everyone
 *  - `visual_style` — deprecated; kept for historical metadata
 *  - `target_audience` — almost always edited per institute; setting it once
 *    shouldn't read as "active"
 *  - `brand_kit_id` — in vimMode, auto-populated to the institute's default
 *    kit by VimBrandKitSelect; not a per-session user choice
 *
 * Tracked separately (not in DEFAULT_OPTIONS or computed from helpers):
 *  - `sub_shots_enabled` (optional with implicit default false)
 *  - `ai_video_enabled` (DEFAULT_OPTIONS has it as false but we count it
 *    because flipping it on materially changes pipeline + cost)
 *  - `host` (undefined by default; truthy means user opted into avatar/raw)
 *  - `visual_preferences` (use shared helper that ignores `auto`/`null`)
 *  - `model_overrides` (undefined by default; truthy with non-empty default
 *    or non-empty per_stage = power-user override worth surfacing)
 *  - `reviewModeEnabled` (lives outside the options object)
 */
const TRACKED_KEYS = [
    'content_type',
    'orientation',
    'target_duration',
    'quality_tier',
    'language',
    'voice_gender',
    'tts_provider',
    'captions_enabled',
    'html_quality',
] as const;

/** Returns true when model_overrides carries any actual override (not just an empty shell). */
function hasActiveModelOverrides(
    overrides: Omit<GenerateVideoRequest, 'prompt'>['model_overrides']
): boolean {
    if (!overrides) return false;
    if (overrides.default) return true;
    if (overrides.per_stage && Object.keys(overrides.per_stage).length > 0) return true;
    return false;
}

function hasActiveBrandOverrides(ov: BrandOverrides | undefined): boolean {
    if (!ov) return false;
    if (ov.system_prompt && ov.system_prompt.trim()) return true;
    if (ov.palette && Object.values(ov.palette).some((v) => !!v)) return true;
    if (ov.intro || ov.outro || ov.watermark) return true;
    return false;
}

/** Count options that diverge from defaults — surfaced as a badge on the trigger. */
function computeNonDefaultCount(
    options: Omit<GenerateVideoRequest, 'prompt'>,
    reviewModeEnabled: boolean | undefined
): number {
    let n = 0;
    for (const key of TRACKED_KEYS) {
        if (options[key] !== DEFAULT_OPTIONS[key]) n++;
    }
    if (options.sub_shots_enabled) n++;
    if (options.dialogue_scenes_enabled) n++;
    if (options.ai_video_enabled) n++;
    if (options.host) n++;
    if (hasActiveVisualPreferences(options.visual_preferences)) n++;
    if (hasActiveModelOverrides(options.model_overrides)) n++;
    if (hasActiveBrandOverrides(options.brand_overrides)) n++;
    if (reviewModeEnabled) n++;
    return n;
}

function SettingsBody({
    options,
    onOptionsChange,
    apiKey,
    reviewModeEnabled,
    onReviewModeChange,
    availableVoices,
    isLoadingVoices,
    playingVoiceId,
    onPlayPreview,
    videoStyle,
    onVideoStyleChange,
    videoBranding,
    onVideoBrandingChange,
    videoTemplates,
    models,
    vimMode = false,
}: SettingsPopoverProps) {
    const { t } = useTranslation(['videoApiStudioSettingsPopover', 'videoApiStudioVideoStyleBranding']);
    const watermarkPositions = buildWatermarkPositions(t);
    const update = <K extends keyof GenerateVideoRequest>(
        key: K,
        value: GenerateVideoRequest[K]
    ) => {
        onOptionsChange({ ...options, [key]: value });
    };

    const [isSavingStyle, setIsSavingStyle] = useState(false);
    const [isSavingBranding, setIsSavingBranding] = useState(false);
    // Snapshot of the picked brand kit so the per-video override panel can show
    // the kit's current values as placeholders. Populated when the user (or the
    // picker's auto-select) chooses a kit; undefined until then.
    const [selectedKit, setSelectedKit] = useState<BrandKit | undefined>(undefined);

    const handleSaveStyle = async () => {
        const instituteId = getInstituteId();
        if (!instituteId) {
            toast.error(t('toasts.noInstituteSelected'));
            return;
        }
        setIsSavingStyle(true);
        try {
            await updateVideoStyle(instituteId, videoStyle);
            toast.success(t('toasts.styleSaved'));
        } catch (err) {
            console.error('Save video style failed', err);
            toast.error(t('toasts.styleSaveFailed'));
        } finally {
            setIsSavingStyle(false);
        }
    };

    const handleSaveBranding = async () => {
        const instituteId = getInstituteId();
        if (!instituteId) {
            toast.error(t('toasts.noInstituteSelected'));
            return;
        }
        setIsSavingBranding(true);
        try {
            await updateVideoBranding(instituteId, videoBranding);
            toast.success(t('toasts.brandingSaved'));
        } catch (err) {
            console.error('Save video branding failed', err);
            toast.error(t('toasts.brandingSaveFailed'));
        } finally {
            setIsSavingBranding(false);
        }
    };

    return (
        <Tabs defaultValue="output" className="w-full">
            <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="output" className="text-xs">
                    {t('tabs.output')}
                </TabsTrigger>
                <TabsTrigger value="voice" className="text-xs">
                    {t('tabs.voice')}
                </TabsTrigger>
                <TabsTrigger value="host" className="text-xs">
                    {t('tabs.host')}
                </TabsTrigger>
                <TabsTrigger value="visuals" className="text-xs">
                    {t('tabs.visuals')}
                </TabsTrigger>
                <TabsTrigger value="advanced" className="text-xs">
                    {t('tabs.advanced')}
                </TabsTrigger>
            </TabsList>

            {/* ============================================================ */}
            {/* OUTPUT — Type, Orientation, Duration, Quality, Model         */}
            {/* ============================================================ */}
            <TabsContent value="output" className="mt-3 space-y-3">
                {/* Content type is admin-only. Vimotion is a video product —
                    QUIZ / STORYBOOK / SLIDES / etc. don't have well-defined
                    brand-kit / host-avatar semantics, and exposing them in the
                    selector confuses studio users. The request body still
                    carries content_type='VIDEO' (defaulted in DEFAULT_OPTIONS),
                    so no BE change is needed. */}
                {!vimMode && (
                    <Field icon={<Layers className="size-3.5" />} label={t('output.contentType.label')}>
                        <Select
                            value={options.content_type || 'VIDEO'}
                            onValueChange={(v) => update('content_type', v as ContentType)}
                        >
                            <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="max-h-80">
                                {buildContentTypes(t).map((ct) => (
                                    <SelectItem key={ct.value} value={ct.value} className="text-xs">
                                        <div className="flex flex-col">
                                            <span>{ct.label}</span>
                                            <span className="text-2xs text-muted-foreground">
                                                {ct.description}
                                            </span>
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Field>
                )}

                {/* Lesson mode — education videos taught by a teacher at a board. */}
                {!vimMode && (options.content_type || 'VIDEO') === 'VIDEO' && (
                    <LessonModePanel options={options} onOptionsChange={onOptionsChange} />
                )}

                <Field
                    icon={
                        (options.orientation || 'landscape') === 'landscape' ? (
                            <Monitor className="size-3.5" />
                        ) : (
                            <Smartphone className="size-3.5" />
                        )
                    }
                    label={t('output.orientation.label')}
                >
                    <div className="inline-flex w-full rounded-lg border bg-muted p-0.5">
                        {(
                            [
                                {
                                    value: 'landscape' as VideoOrientation,
                                    label: t('output.orientation.landscape'),
                                    icon: Monitor,
                                },
                                {
                                    value: 'portrait' as VideoOrientation,
                                    label: t('output.orientation.portrait'),
                                    icon: Smartphone,
                                },
                            ] as const
                        ).map(({ value, label, icon: Icon }) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => update('orientation', value)}
                                className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                                    (options.orientation || 'landscape') === value
                                        ? 'bg-background text-foreground shadow-sm'
                                        : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                <Icon className="size-3.5" />
                                {label}
                            </button>
                        ))}
                    </div>
                </Field>

                <Field icon={<Clock className="size-3.5" />} label={t('output.duration.label')}>
                    <Select
                        value={options.target_duration}
                        onValueChange={(v) => update('target_duration', v)}
                    >
                        <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {buildTargetDurationOptions(t).map((d) => (
                                <SelectItem key={d.value} value={d.value} className="text-xs">
                                    {d.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </Field>

                <Field icon={<SparklesIcon className="size-3.5" />} label={t('output.qualityTier.label')}>
                    <Select
                        value={options.quality_tier || 'ultra'}
                        onValueChange={(v) =>
                            onOptionsChange({
                                ...options,
                                quality_tier: v as QualityTier,
                                model: '',
                            })
                        }
                    >
                        <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {buildQualityTiers(t).map((tier) => (
                                <SelectItem key={tier.value} value={tier.value} className="text-xs">
                                    <div className="flex items-center gap-1.5">
                                        <span className="font-medium">{tier.label}</span>
                                        {tier.badge && (
                                            <Badge
                                                variant="secondary"
                                                className="h-4 px-1 text-2xs"
                                            >
                                                {tier.badge}
                                            </Badge>
                                        )}
                                    </div>
                                    <span className="text-2xs text-muted-foreground">
                                        {tier.description}
                                    </span>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </Field>

                {/* Top-level Model override is admin-only. The Advanced-tab
                    ModelOverridesPanel is the canonical V200 entry point for
                    per-stage overrides — it's visible in vimMode too (power
                    users can reach it via Advanced). This Output-tab dropdown
                    is the legacy single-model knob; keeping it admin-only
                    avoids two competing override surfaces on a primary tab.
                    The auto-select effect in Composer.tsx is also gated on
                    !vimMode so `options.model` doesn't ship as a ghost field. */}
                {!vimMode && (
                    <Field
                        icon={<Wand2 className="size-3.5" />}
                        label={t('output.modelOverride.label')}
                        helper={t('output.modelOverride.helper')}
                    >
                        <Select
                            value={options.model || ''}
                            onValueChange={(v) => update('model', v)}
                        >
                            <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder={t('output.modelOverride.placeholder')} />
                            </SelectTrigger>
                            <SelectContent className="max-h-60">
                                {models.map((m) => (
                                    <SelectItem
                                        key={m.model_id}
                                        value={m.model_id}
                                        className="text-xs"
                                    >
                                        <span>{m.name}</span>
                                        {m.is_free && (
                                            <Badge
                                                variant="outline"
                                                className="ms-1 h-3.5 px-1 text-2xs"
                                            >
                                                {t('output.modelOverride.freeBadge')}
                                            </Badge>
                                        )}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Field>
                )}
            </TabsContent>

            {/* ============================================================ */}
            {/* VOICE — Language, Gender, Provider, Voice ID, Audience       */}
            {/* ============================================================ */}
            <TabsContent value="voice" className="mt-3 space-y-3">
                <Field icon={<Globe className="size-3.5" />} label={t('voice.language.label')}>
                    <Select value={options.language} onValueChange={(v) => update('language', v)}>
                        <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="max-h-60">
                            {Array.from(new Set(LANGUAGES.map((l) => l.group))).map(
                                (group, idx) => (
                                    <div key={group}>
                                        <div
                                            className={`${
                                                idx === 0 ? '' : 'mt-2 '
                                            }px-2 py-1 text-xs font-semibold text-muted-foreground`}
                                        >
                                            {group}
                                        </div>
                                        {LANGUAGES.filter((l) => l.group === group).map((lang) => (
                                            <SelectItem
                                                key={lang.value}
                                                value={lang.value}
                                                className="text-xs"
                                            >
                                                {lang.label}
                                            </SelectItem>
                                        ))}
                                    </div>
                                )
                            )}
                        </SelectContent>
                    </Select>
                </Field>

                <Field icon={<Mic className="size-3.5" />} label={t('voice.voiceGender.label')}>
                    <Select
                        value={options.voice_gender}
                        onValueChange={(v) => update('voice_gender', v as VoiceGender)}
                    >
                        <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {buildVoiceGenders(t).map((g) => (
                                <SelectItem key={g.value} value={g.value} className="text-xs">
                                    {g.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </Field>

                <Field icon={<Volume2 className="size-3.5" />} label={t('voice.audioQuality.label')}>
                    <Select
                        value={options.tts_provider}
                        onValueChange={(v) => update('tts_provider', v as TtsProvider)}
                    >
                        <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {buildTtsProviders(t).map((p) => (
                                <SelectItem key={p.value} value={p.value} className="text-xs">
                                    <div className="flex flex-col">
                                        <span>{p.label}</span>
                                        <span className="text-2xs text-muted-foreground">
                                            {p.description}
                                        </span>
                                    </div>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </Field>

                {/* Voice ID picker — premium only; standard has one fixed voice */}
                <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Mic className="size-3.5" />
                        {t('voice.voiceList.label')}{' '}
                        {isLoadingVoices && <Loader2 className="size-3 animate-spin" />}
                    </Label>
                    {availableVoices.length > 0 ? (
                        <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-1">
                            {availableVoices.map((voice) => {
                                const isSelected = options.voice_id === voice.id;
                                const isPlaying = playingVoiceId === voice.id;
                                return (
                                    <div
                                        key={voice.id}
                                        className={`flex items-center justify-between rounded-md px-2 py-1.5 text-xs transition-colors ${
                                            isSelected
                                                ? 'bg-violet-50 dark:bg-violet-950/40'
                                                : 'hover:bg-muted'
                                        }`}
                                    >
                                        <button
                                            type="button"
                                            className="flex-1 text-left"
                                            onClick={() => {
                                                onOptionsChange({
                                                    ...options,
                                                    voice_id: voice.id,
                                                });
                                            }}
                                        >
                                            <span className="font-medium">{voice.name}</span>
                                            <span className="ms-1 text-2xs text-muted-foreground">
                                                {voice.provider === 'sarvam'
                                                    ? t('voice.voiceList.providerSarvam')
                                                    : voice.provider === 'google'
                                                      ? t('voice.voiceList.providerGoogle')
                                                      : t('voice.voiceList.providerEdge')}
                                            </span>
                                        </button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            type="button"
                                            aria-label={
                                                isPlaying
                                                    ? t('voice.voiceList.stopPreviewAria', {
                                                          name: voice.name,
                                                      })
                                                    : t('voice.voiceList.playPreviewAria', {
                                                          name: voice.name,
                                                      })
                                            }
                                            title={
                                                isPlaying
                                                    ? t('voice.voiceList.stopPreviewTitle')
                                                    : t('voice.voiceList.playPreviewTitle')
                                            }
                                            className={[
                                                'size-7 shrink-0 rounded-full p-0 transition-colors',
                                                isPlaying
                                                    ? 'bg-violet-600 text-white shadow-sm hover:bg-violet-700 hover:text-white'
                                                    : 'text-muted-foreground hover:bg-violet-100 hover:text-violet-700 dark:hover:bg-violet-950/40',
                                            ].join(' ')}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onPlayPreview(voice);
                                            }}
                                        >
                                            {isPlaying ? (
                                                <Pause className="size-3.5 fill-current" />
                                            ) : (
                                                <Play className="ml-0.5 size-3.5 fill-current" />
                                            )}
                                        </Button>
                                    </div>
                                );
                            })}
                        </div>
                    ) : !isLoadingVoices ? (
                        <p className="text-2xs text-muted-foreground">
                            {t('voice.voiceList.noVoices')}
                        </p>
                    ) : null}
                </div>

                {/* Target audience exists as a planner hint for the edtech
                    parent product (Class 1-2 → Graduate / Professional). For
                    Vimotion (studios, agencies, individuals making brand /
                    marketing / promo videos) this field is a confusing edtech
                    artifact — the planner can infer audience from the prompt
                    directly. Hidden in vimMode; the default value still
                    ships in the request via DEFAULT_OPTIONS. */}
                {!vimMode && (
                    <Field icon={<Users className="size-3.5" />} label={t('voice.audience.label')}>
                        <Select
                            value={options.target_audience}
                            onValueChange={(v) => update('target_audience', v)}
                        >
                            <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {buildTargetAudienceOptions(t).map((a) => (
                                    <SelectItem key={a.value} value={a.value} className="text-xs">
                                        {a.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Field>
                )}
            </TabsContent>

            {/* ============================================================ */}
            {/* VISUALS — HTML quality, Captions, Style, Branding            */}
            {/* ============================================================ */}
            <TabsContent value="visuals" className="mt-3 space-y-3">
                <Field icon={<Wand2 className="size-3.5" />} label={t('visuals.visualQuality.label')}>
                    <Select
                        value={options.html_quality}
                        onValueChange={(v) => update('html_quality', v as 'classic' | 'advanced')}
                    >
                        <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="classic" className="text-xs">
                                {t('visuals.visualQuality.classic')}
                            </SelectItem>
                            <SelectItem value="advanced" className="text-xs">
                                {t('visuals.visualQuality.advanced')}
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </Field>

                <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1.5 text-xs">
                        <Captions className="size-3.5 text-muted-foreground" />
                        {t('visuals.captions.label')}
                    </Label>
                    <Switch
                        checked={options.captions_enabled}
                        onCheckedChange={(v) => update('captions_enabled', v)}
                    />
                </div>

                {vimMode && (
                    <div className="space-y-1.5">
                        <Label className="flex items-center gap-1.5 text-xs">
                            <Palette className="size-3.5 text-muted-foreground" />
                            {t('visuals.brandKit.label')}
                        </Label>
                        <VimBrandKitSelect
                            value={options.brand_kit_id}
                            onChange={(kitId, kit) => {
                                setSelectedKit(kit);
                                onOptionsChange({ ...options, brand_kit_id: kitId });
                            }}
                        />
                        <p className="text-2xs text-muted-foreground">
                            {t('visuals.brandKit.helper')}
                        </p>
                        <BrandKitOverridePanel
                            value={options.brand_overrides}
                            selectedKit={selectedKit}
                            onChange={(next) => update('brand_overrides', next)}
                        />
                    </div>
                )}

                {!vimMode && (
                    <>
                        {/* Style — editable inline */}
                        <details
                            open
                            className="group rounded-md border bg-muted/30 [&_summary::-webkit-details-marker]:hidden"
                        >
                            <summary className="flex cursor-pointer list-none items-center justify-between px-2.5 py-2 text-xs font-medium">
                                <span className="flex items-center gap-1.5">
                                    <Palette className="size-3.5 text-muted-foreground" />
                                    {t('visuals.style.title')}
                                </span>
                                <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
                            </summary>
                            <div className="space-y-2.5 border-t p-2.5">
                                {/* Background type */}
                                <div className="space-y-1">
                                    <Label className="text-2xs uppercase tracking-wide text-muted-foreground">
                                        {t('visuals.style.background.label')}
                                    </Label>
                                    <div className="grid grid-cols-2 gap-1">
                                        {(['white', 'black'] as const).map((v) => (
                                            <button
                                                key={v}
                                                type="button"
                                                onClick={() =>
                                                    onVideoStyleChange((s) => ({
                                                        ...s,
                                                        background_type: v,
                                                    }))
                                                }
                                                className={`rounded-md border px-2 py-1 text-xs capitalize transition-colors ${
                                                    videoStyle.background_type === v
                                                        ? 'border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'
                                                        : 'hover:bg-muted'
                                                }`}
                                            >
                                                {v === 'white'
                                                    ? t('visuals.style.background.light')
                                                    : t('visuals.style.background.dark')}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Layout theme — visual gallery */}
                                <div className="space-y-1">
                                    <Label className="text-2xs uppercase tracking-wide text-muted-foreground">
                                        {t('visuals.style.layoutTheme.label')}
                                    </Label>
                                    <div className="grid grid-cols-2 gap-2">
                                        <ThemeCard
                                            label={t('visuals.style.layoutTheme.defaultLabel')}
                                            description={t(
                                                'visuals.style.layoutTheme.defaultDescription'
                                            )}
                                            selected={!videoStyle.layout_theme}
                                            onSelect={() =>
                                                onVideoStyleChange((s) => ({
                                                    ...s,
                                                    layout_theme: '',
                                                }))
                                            }
                                        />
                                        {videoTemplates.map((tmpl) => (
                                            <ThemeCard
                                                key={tmpl.id}
                                                label={tmpl.name}
                                                description={tmpl.description}
                                                previewHtml={tmpl.preview_html}
                                                primaryColor={videoStyle.primary_color}
                                                selected={videoStyle.layout_theme === tmpl.id}
                                                onSelect={() =>
                                                    onVideoStyleChange((s) => ({
                                                        ...s,
                                                        layout_theme: tmpl.id,
                                                        background_type: tmpl.background_type,
                                                    }))
                                                }
                                            />
                                        ))}
                                    </div>
                                </div>

                                {/* Primary color */}
                                <div className="space-y-1">
                                    <Label className="text-2xs uppercase tracking-wide text-muted-foreground">
                                        {t('visuals.style.primaryColor')}
                                    </Label>
                                    <div className="flex items-center gap-2">
                                        <ColorPicker
                                            value={videoStyle.primary_color}
                                            onChange={(color) =>
                                                onVideoStyleChange((s) => ({
                                                    ...s,
                                                    primary_color: color,
                                                }))
                                            }
                                        />
                                        <span className="font-mono text-xs text-muted-foreground">
                                            {videoStyle.primary_color}
                                        </span>
                                    </div>
                                </div>

                                {/* Fonts */}
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="space-y-1">
                                        <Label className="flex items-center gap-1 text-2xs uppercase tracking-wide text-muted-foreground">
                                            <TypeIcon className="size-3" />
                                            {t('visuals.style.heading')}
                                        </Label>
                                        <Select
                                            value={videoStyle.heading_font}
                                            onValueChange={(v) =>
                                                onVideoStyleChange((s) => ({
                                                    ...s,
                                                    heading_font: v,
                                                }))
                                            }
                                        >
                                            <SelectTrigger
                                                className="h-9 text-sm"
                                                style={{ fontFamily: videoStyle.heading_font }}
                                            >
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {FONT_OPTIONS.map((f) => (
                                                    <SelectItem
                                                        key={f}
                                                        value={f}
                                                        className="text-sm"
                                                        style={{ fontFamily: f }}
                                                    >
                                                        {f}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="flex items-center gap-1 text-2xs uppercase tracking-wide text-muted-foreground">
                                            <TypeIcon className="size-3" />
                                            {t('visuals.style.body')}
                                        </Label>
                                        <Select
                                            value={videoStyle.body_font}
                                            onValueChange={(v) =>
                                                onVideoStyleChange((s) => ({ ...s, body_font: v }))
                                            }
                                        >
                                            <SelectTrigger
                                                className="h-9 text-sm"
                                                style={{ fontFamily: videoStyle.body_font }}
                                            >
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {FONT_OPTIONS.map((f) => (
                                                    <SelectItem
                                                        key={f}
                                                        value={f}
                                                        className="text-sm"
                                                        style={{ fontFamily: f }}
                                                    >
                                                        {f}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                <div className="flex justify-end pt-1">
                                    <Button
                                        size="sm"
                                        onClick={handleSaveStyle}
                                        disabled={isSavingStyle}
                                        className="h-7 gap-1 text-xs"
                                    >
                                        {isSavingStyle ? (
                                            <Loader2 className="size-3 animate-spin" />
                                        ) : (
                                            <Save className="size-3" />
                                        )}
                                        {t('visuals.style.saveStyle')}
                                    </Button>
                                </div>
                            </div>
                        </details>

                        {/* Branding — Intro / Outro / Watermark */}
                        <details className="group rounded-md border bg-muted/30 [&_summary::-webkit-details-marker]:hidden">
                            <summary className="flex cursor-pointer list-none items-center justify-between px-2.5 py-2 text-xs font-medium">
                                <span className="flex items-center gap-1.5">
                                    <Film className="size-3.5 text-muted-foreground" />
                                    {t('visuals.branding.title')}
                                </span>
                                <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
                            </summary>
                            <div className="space-y-3 border-t p-2.5">
                                {/* Intro */}
                                <IntroOutroEditor
                                    label={t('introOutro.intro')}
                                    value={videoBranding.intro}
                                    onChange={(next) =>
                                        onVideoBrandingChange((b) => ({ ...b, intro: next }))
                                    }
                                />
                                {/* Outro */}
                                <IntroOutroEditor
                                    label={t('introOutro.outro')}
                                    value={videoBranding.outro}
                                    onChange={(next) =>
                                        onVideoBrandingChange((b) => ({ ...b, outro: next }))
                                    }
                                />
                                {/* Watermark */}
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <Label className="text-xs font-medium">
                                            {t('visuals.branding.watermark')}
                                        </Label>
                                        <Switch
                                            checked={videoBranding.watermark.enabled}
                                            onCheckedChange={(v) =>
                                                onVideoBrandingChange((b) => ({
                                                    ...b,
                                                    watermark: { ...b.watermark, enabled: v },
                                                }))
                                            }
                                        />
                                    </div>
                                    {videoBranding.watermark.enabled && (
                                        <div className="grid grid-cols-2 gap-1 pl-1">
                                            {watermarkPositions.map((p) => (
                                                <button
                                                    key={p.value}
                                                    type="button"
                                                    onClick={() =>
                                                        onVideoBrandingChange((b) => ({
                                                            ...b,
                                                            watermark: {
                                                                ...b.watermark,
                                                                position:
                                                                    p.value as WatermarkPosition,
                                                            },
                                                        }))
                                                    }
                                                    className={`rounded-md border px-2 py-1 text-2xs transition-colors ${
                                                        videoBranding.watermark.position === p.value
                                                            ? 'border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'
                                                            : 'hover:bg-muted'
                                                    }`}
                                                >
                                                    {p.label}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="flex items-center justify-between gap-2 pt-1">
                                    <Link
                                        to="/settings"
                                        search={{ selectedTab: 'aiSettings' }}
                                        className="flex items-center gap-1 text-2xs text-violet-600 hover:underline"
                                    >
                                        <ExternalLink className="size-2.5" />
                                        {t('visuals.branding.editLink')}
                                    </Link>
                                    <Button
                                        size="sm"
                                        onClick={handleSaveBranding}
                                        disabled={isSavingBranding}
                                        className="h-7 gap-1 text-xs"
                                    >
                                        {isSavingBranding ? (
                                            <Loader2 className="size-3 animate-spin" />
                                        ) : (
                                            <Save className="size-3" />
                                        )}
                                        {t('visuals.branding.saveBranding')}
                                    </Button>
                                </div>
                            </div>
                        </details>
                    </>
                )}
            </TabsContent>

            {/* ============================================================ */}
            {/* ADVANCED — Sub-shots, Review script, etc                     */}
            {/* ============================================================ */}
            {/* ============================================================ */}
            {/* HOST — On-screen narrator (avatar / raw)                     */}
            {/* ============================================================ */}
            <TabsContent value="host" className="mt-3 space-y-3">
                {options.lesson?.enabled ? (
                    <p className="rounded-lg border p-3 text-xs text-muted-foreground">
                        {t('lesson.hostDisabled')}
                    </p>
                ) : (
                    <HostTabBody
                        options={options}
                        onOptionsChange={onOptionsChange}
                        vimMode={vimMode}
                    />
                )}
            </TabsContent>

            <TabsContent value="advanced" className="mt-3 space-y-3">
                {onReviewModeChange && (
                    <div className="space-y-1">
                        <div className="flex items-center justify-between">
                            <Label className="flex items-center gap-1.5 text-xs">
                                <FileText className="size-3.5 text-muted-foreground" />
                                {t('advanced.reviewMode.label')}
                            </Label>
                            <Switch
                                checked={!!reviewModeEnabled}
                                onCheckedChange={onReviewModeChange}
                            />
                        </div>
                        <p className="ps-5 text-2xs text-muted-foreground">
                            {t('advanced.reviewMode.helper')}
                        </p>
                    </div>
                )}

                <div className="space-y-1">
                    <div className="flex items-center justify-between">
                        <Label className="flex items-center gap-1.5 text-xs">
                            <Scissors className="size-3.5 text-muted-foreground" />
                            {t('advanced.subShots.label')}
                            <Badge
                                variant="outline"
                                className="h-4 px-1 text-2xs uppercase tracking-wide"
                            >
                                {t('advanced.expBadge')}
                            </Badge>
                        </Label>
                        <Switch
                            checked={!!options.sub_shots_enabled}
                            onCheckedChange={(v) => update('sub_shots_enabled', v)}
                        />
                    </div>
                    <p className="ps-5 text-2xs text-muted-foreground">
                        {t('advanced.subShots.helper')}
                    </p>
                </div>

                <div className="space-y-1">
                    <div className="flex items-center justify-between">
                        <Label className="flex items-center gap-1.5 text-xs">
                            <Users className="size-3.5 text-muted-foreground" />
                            {t('advanced.dialogueScenes.label')}
                            <Badge
                                variant="outline"
                                className="h-4 px-1 text-2xs uppercase tracking-wide"
                            >
                                {t('advanced.expBadge')}
                            </Badge>
                        </Label>
                        <Switch
                            checked={!!options.dialogue_scenes_enabled}
                            onCheckedChange={(v) => update('dialogue_scenes_enabled', v)}
                        />
                    </div>
                    <p className="ps-5 text-2xs text-muted-foreground">
                        {t('advanced.dialogueScenes.helper')}
                    </p>
                    {!!options.dialogue_scenes_enabled && (
                        <div className="space-y-1.5 pl-5 pt-1">
                            <div className="flex gap-1.5">
                                {(
                                    [
                                        {
                                            v: 'storybook',
                                            label: t('advanced.dialogueMode.storybook.label'),
                                            desc: t(
                                                'advanced.dialogueMode.storybook.description'
                                            ),
                                        },
                                        {
                                            v: 'drama',
                                            label: t('advanced.dialogueMode.drama.label'),
                                            desc: t('advanced.dialogueMode.drama.description'),
                                        },
                                    ] as const
                                ).map((m) => {
                                    const active = (options.dialogue_mode ?? 'storybook') === m.v;
                                    return (
                                        <button
                                            key={m.v}
                                            type="button"
                                            title={m.desc}
                                            onClick={() => update('dialogue_mode', m.v)}
                                            className={`rounded-full border px-2.5 py-0.5 text-2xs transition-colors ${
                                                active
                                                    ? 'border-primary-500 bg-primary-50 text-foreground'
                                                    : 'text-muted-foreground hover:text-foreground'
                                            }`}
                                        >
                                            {m.label}
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="flex gap-1.5">
                                {(
                                    [
                                        {
                                            v: 'seedance-2.0',
                                            label: t('advanced.dialogueClipModel.seedance.label'),
                                            desc: t(
                                                'advanced.dialogueClipModel.seedance.description'
                                            ),
                                        },
                                        {
                                            v: 'omni-flash',
                                            label: t('advanced.dialogueClipModel.omniFlash.label'),
                                            desc: t(
                                                'advanced.dialogueClipModel.omniFlash.description'
                                            ),
                                        },
                                    ] as const
                                ).map((m) => {
                                    const active =
                                        (options.dialogue_clip_model ?? 'seedance-2.0') === m.v;
                                    return (
                                        <button
                                            key={m.v}
                                            type="button"
                                            title={m.desc}
                                            onClick={() => update('dialogue_clip_model', m.v)}
                                            className={`rounded-full border px-2.5 py-0.5 text-2xs transition-colors ${
                                                active
                                                    ? 'border-primary-500 bg-primary-50 text-foreground'
                                                    : 'text-muted-foreground hover:text-foreground'
                                            }`}
                                        >
                                            {m.label}
                                        </button>
                                    );
                                })}
                            </div>
                            <CastPicker
                                apiKey={apiKey ?? undefined}
                                castId={options.cast_id}
                                onChange={(v) => update('cast_id', v)}
                            />
                        </div>
                    )}
                </div>

                <AiVideoPanel
                    enabled={!!options.ai_video_enabled}
                    audioEnabled={!!options.ai_video_audio_enabled}
                    model={options.ai_video_model}
                    qualityTier={options.quality_tier || 'ultra'}
                    onChange={(patch) => {
                        if ('enabled' in patch) {
                            update('ai_video_enabled', patch.enabled);
                            // Pin the model when enabling so the request SENDS
                            // what the dropdown SHOWS. Without this the panel
                            // displays the [0] default (best quality) but
                            // leaves ai_video_model undefined → the backend
                            // falls back to the lite tier the user disliked.
                            if (patch.enabled && !options.ai_video_model) {
                                update('ai_video_model', AI_VIDEO_MODELS[0].value);
                            }
                        }
                        if ('audioEnabled' in patch)
                            update('ai_video_audio_enabled', patch.audioEnabled);
                        if ('model' in patch) update('ai_video_model', patch.model);
                    }}
                />

                {/* Per-stage model overrides — visible in Advanced for ALL
                    modes (admin and vimMode). The Output-tab top-level dropdown
                    stays admin-only because it duplicates this panel; this
                    panel is the modern V200 entry point and is already gracefully
                    tiered (one default dropdown up front, per-stage controls
                    behind an "advanced" expander). Vimotion power users who
                    want to swap the per-shot-HTML model find it here. */}
                <ModelOverridesPanel
                    overrides={options.model_overrides}
                    onChange={(next) => update('model_overrides', next)}
                />

                {/* Top-level `options.model` (legacy single-model knob) is
                    still suppressed in vimMode — it overlaps with the panel
                    above and the auto-select effect that populates it is
                    skipped in vimMode (see Composer.tsx). Power users get
                    one canonical override surface, not two. */}

                <VisualPreferencesPanel
                    prefs={options.visual_preferences}
                    qualityTier={options.quality_tier || 'ultra'}
                    captionsEnabled={options.captions_enabled}
                    onChange={(next) => update('visual_preferences', next)}
                />
            </TabsContent>
        </Tabs>
    );
}

// ─────────────────────────────────────────────────────────────────────────
// AiVideoPanel — Phase 3b–6 user-facing toggle
//
// Three controls:
//   - Enable AI video (master toggle)
//   - Model dropdown (Phase 3 ships with one option; future-proofed)
//   - Veo audio toggle (visible only when AI video is on)
//
// Disabled with an explanation when the run's quality_tier is below ultra,
// since the backend hard-gates eligibility there. The disabled state keeps
// any previously-set values intact — switching tier back up restores them.
// ─────────────────────────────────────────────────────────────────────────

interface AiVideoPanelChange {
    enabled?: boolean;
    audioEnabled?: boolean;
    model?: AiVideoModel;
}

function AiVideoPanel({
    enabled,
    audioEnabled,
    model,
    qualityTier,
    onChange,
}: {
    enabled: boolean;
    audioEnabled: boolean;
    model: AiVideoModel | undefined;
    qualityTier: QualityTier;
    onChange: (patch: AiVideoPanelChange) => void;
}) {
    const { t } = useTranslation(['videoApiStudioSettingsPopover', 'videoApiStudioCredits']);
    const tierEligible = qualityTier === 'ultra' || qualityTier === 'super_ultra';
    const effectiveModel: AiVideoModel = model ?? AI_VIDEO_MODELS[0].value;
    // Live USD→credits rate (V252-driven; falls back to seed 150× when offline).
    // Used to render the per-shot range, per-video cap, and per-second
    // Veo audio rate as credit values.
    const ratio = useEffectiveCreditRatio();
    const perShotMinCredits = formatCredits(usdToCredits(0.12, ratio), { suffix: '', t });
    const perShotMaxCredits = formatCredits(usdToCredits(0.4, ratio), { suffix: '', t });
    const perVideoCapCredits = formatCredits(usdToCredits(1.5, ratio), { suffix: 'credits', t });
    const audioOffPerSec = formatCredits(usdToCredits(0.03, ratio), { precision: 1, suffix: '', t });
    const audioOnPerSec = formatCredits(usdToCredits(0.05, ratio), { precision: 1, suffix: '', t });
    return (
        <div className="space-y-3 rounded-md border border-border/60 bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-3">
                <Label className="flex items-center gap-1.5 text-xs font-medium">
                    <Film className="size-3.5" />
                    {t('aiVideo.label')}
                    <Badge variant="outline" className="px-1 py-0 text-2xs">
                        {t('aiVideo.betaBadge')}
                    </Badge>
                </Label>
                <Switch
                    checked={enabled && tierEligible}
                    disabled={!tierEligible}
                    onCheckedChange={(v) => onChange({ enabled: v })}
                    aria-label={t('aiVideo.enableAria')}
                />
            </div>
            {!tierEligible && (
                <p className="ps-5 text-2xs text-amber-600">{t('aiVideo.tierLocked')}</p>
            )}
            {tierEligible && (
                <p className="ps-5 text-2xs text-muted-foreground">
                    {t('aiVideo.description', {
                        minCredits: perShotMinCredits,
                        maxCredits: perShotMaxCredits,
                        capCredits: perVideoCapCredits,
                    })}
                </p>
            )}
            {enabled && tierEligible && (
                <>
                    <div className="space-y-1.5 pl-5">
                        <Label className="text-2xs text-muted-foreground">
                            {t('aiVideo.modelLabel')}
                        </Label>
                        <Select
                            value={effectiveModel}
                            onValueChange={(v) => onChange({ model: v as AiVideoModel })}
                        >
                            <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {buildAiVideoModels(t).map((m) => (
                                    <SelectItem key={m.value} value={m.value} className="text-xs">
                                        {m.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {buildAiVideoModels(t).find((m) => m.value === effectiveModel)?.hint && (
                            <p className="pl-0.5 text-xs text-muted-foreground">
                                {buildAiVideoModels(t).find((m) => m.value === effectiveModel)?.hint}
                            </p>
                        )}
                    </div>
                    <div className="flex items-center justify-between gap-3 pl-5">
                        <Label className="flex items-center gap-1.5 text-2xs">
                            <Volume2 className="size-3" />
                            {t('aiVideo.veoAudioLabel')}
                        </Label>
                        <Switch
                            checked={audioEnabled}
                            onCheckedChange={(v) => onChange({ audioEnabled: v })}
                            aria-label={t('aiVideo.veoAudioAria')}
                        />
                    </div>
                    <p className="ps-5 text-2xs text-muted-foreground">
                        {t('aiVideo.audioCostNote', {
                            offRate: audioOffPerSec,
                            onRate: audioOnPerSec,
                        })}
                    </p>
                </>
            )}
        </div>
    );
}

function Field({
    icon,
    label,
    helper,
    children,
}: {
    icon: React.ReactNode;
    label: string;
    helper?: string;
    children: React.ReactNode;
}) {
    return (
        <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {icon}
                {label}
            </Label>
            {children}
            {helper && <p className="text-2xs text-muted-foreground">{helper}</p>}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────
// VisualPreferencesPanel — Slice E
// 5 family bias controls (Avoid / Auto / Prefer) + 1 text-density control
// (Minimal / Low / Auto / Rich). Below `premium`, the Director doesn't run,
// so we surface a hint that family bias is applied via the script LLM only.
// ─────────────────────────────────────────────────────────────────────────

function buildFamilyBiasOptions(
    t: TFunction
): ReadonlyArray<{ value: FamilyBias; label: string }> {
    return [
        { value: 'no', label: t('visualPreferences.familyBias.avoid') },
        { value: 'auto', label: t('visualPreferences.familyBias.auto') },
        { value: 'high', label: t('visualPreferences.familyBias.prefer') },
    ];
}

function buildTextDensityOptions(t: TFunction): ReadonlyArray<{
    value: TextDensity;
    label: string;
    desc: string;
}> {
    return [
        {
            value: 'minimal',
            label: t('visualPreferences.textDensity.minimal.label'),
            desc: t('visualPreferences.textDensity.minimal.description'),
        },
        {
            value: 'low',
            label: t('visualPreferences.textDensity.low.label'),
            desc: t('visualPreferences.textDensity.low.description'),
        },
        {
            value: 'auto',
            label: t('visualPreferences.textDensity.auto.label'),
            desc: t('visualPreferences.textDensity.auto.description'),
        },
        {
            value: 'rich',
            label: t('visualPreferences.textDensity.rich.label'),
            desc: t('visualPreferences.textDensity.rich.description'),
        },
    ];
}

function buildVisualStyleOptions(t: TFunction): ReadonlyArray<{
    value: VisualStyleMode;
    label: string;
    desc: string;
}> {
    return [
        {
            value: 'auto',
            label: t('visualPreferences.visualStyle.auto.label'),
            desc: t('visualPreferences.visualStyle.auto.description'),
        },
        {
            value: 'educational',
            label: t('visualPreferences.visualStyle.educational.label'),
            desc: t('visualPreferences.visualStyle.educational.description'),
        },
        {
            value: 'marketing',
            label: t('visualPreferences.visualStyle.marketing.label'),
            desc: t('visualPreferences.visualStyle.marketing.description'),
        },
        {
            value: 'bold',
            label: t('visualPreferences.visualStyle.bold.label'),
            desc: t('visualPreferences.visualStyle.bold.description'),
        },
    ];
}

function VisualPreferencesPanel({
    prefs,
    qualityTier,
    captionsEnabled,
    onChange,
}: {
    prefs: VisualPreferences | undefined;
    qualityTier: QualityTier;
    captionsEnabled: boolean;
    onChange: (next: VisualPreferences | undefined) => void;
}) {
    const { t } = useTranslation('videoApiStudioSettingsPopover');
    const current: VisualPreferences = prefs ?? {};
    const isActive = hasActiveVisualPreferences(current);
    const directorRuns =
        qualityTier === 'premium' || qualityTier === 'ultra' || qualityTier === 'super_ultra';
    const textDensity: TextDensity = (current.text_density ?? 'auto') as TextDensity;
    const styleMode: VisualStyleMode = (current.visual_style_mode ?? 'auto') as VisualStyleMode;
    const showCaptionsHint =
        (textDensity === 'minimal' || textDensity === 'low') && !captionsEnabled;
    // Render the tier's friendly label (from buildQualityTiers), not the raw
    // backend enum value — showing e.g. "super_ultra" verbatim would be a
    // rendered-enum bug.
    const qualityTierLabel =
        buildQualityTiers(t).find((tier) => tier.value === qualityTier)?.label ?? qualityTier;
    const familyBiasOptions = buildFamilyBiasOptions(t);
    const textDensityOptions = buildTextDensityOptions(t);
    const visualStyleOptions = buildVisualStyleOptions(t);

    function setStyleMode(value: VisualStyleMode) {
        const next: VisualPreferences = { ...current };
        if (value === 'auto') {
            delete next.visual_style_mode;
        } else {
            next.visual_style_mode = value;
        }
        onChange(hasActiveVisualPreferences(next) ? next : undefined);
    }

    function setBias(
        family: keyof Omit<VisualPreferences, 'text_density' | 'visual_style_mode'>,
        value: FamilyBias,
    ) {
        const next: VisualPreferences = { ...current };
        // Drop the field entirely on "auto" so the persisted slider state stays
        // small and the BE distinguishes "explicitly auto" from "untouched"
        // only via "user explicitly clicked" telemetry — not necessary for v1.
        if (value === 'auto') {
            delete next[family];
        } else {
            next[family] = value;
        }
        onChange(hasActiveVisualPreferences(next) ? next : undefined);
    }

    function setDensity(value: TextDensity) {
        const next: VisualPreferences = { ...current };
        if (value === 'auto') {
            delete next.text_density;
        } else {
            next.text_density = value;
        }
        onChange(hasActiveVisualPreferences(next) ? next : undefined);
    }

    function reset() {
        onChange(undefined);
    }

    return (
        <div className="mt-1 space-y-2 rounded-md border border-dashed border-muted-foreground/20 p-2.5">
            <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5 text-xs">
                    <Palette className="size-3.5 text-muted-foreground" />
                    {t('visualPreferences.label')}
                    {isActive && (
                        <Badge
                            variant="outline"
                            className="h-4 px-1 text-2xs uppercase tracking-wide"
                        >
                            {t('visualPreferences.activeBadge')}
                        </Badge>
                    )}
                </Label>
                {isActive && (
                    <button
                        type="button"
                        onClick={reset}
                        className="text-2xs text-muted-foreground underline-offset-2 hover:underline"
                    >
                        {t('visualPreferences.reset')}
                    </button>
                )}
            </div>
            <p className="text-2xs text-muted-foreground">
                {t('visualPreferences.hint')}
                {!directorRuns && (
                    <Trans
                        i18nKey="videoApiStudioSettingsPopover:visualPreferences.directorHint"
                        values={{ tierLabel: qualityTierLabel }}
                        components={{ tier: <span className="font-medium" /> }}
                    />
                )}
            </p>

            {/* Family sliders */}
            <div className="space-y-1.5 pt-0.5">
                {buildVisualPreferenceFamilies(t).map(({ key, label }) => {
                    const value = (current[key] ?? 'auto') as FamilyBias;
                    return (
                        <div key={key} className="flex items-center justify-between gap-2">
                            <span className="text-2xs text-muted-foreground">{label}</span>
                            <div className="inline-flex rounded-md border bg-muted p-0.5">
                                {familyBiasOptions.map((opt) => {
                                    const active = value === opt.value;
                                    return (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            onClick={() => setBias(key, opt.value)}
                                            className={`rounded-sm px-2 py-0.5 text-2xs uppercase tracking-wide transition-colors ${
                                                active
                                                    ? 'bg-background text-foreground shadow-sm'
                                                    : 'text-muted-foreground hover:text-foreground'
                                            }`}
                                        >
                                            {opt.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Visual style — overall aesthetic for the whole video */}
            <div className="space-y-1 pt-1.5">
                <Label className="flex items-center gap-1.5 text-2xs">
                    <SparklesIcon className="size-3.5 text-muted-foreground" />
                    {t('visualPreferences.visualStyleLabel')}
                </Label>
                <div className="flex w-full rounded-md border bg-muted p-0.5">
                    {visualStyleOptions.map((opt) => {
                        const active = styleMode === opt.value;
                        return (
                            <button
                                key={opt.value}
                                type="button"
                                onClick={() => setStyleMode(opt.value)}
                                title={opt.desc}
                                className={`flex-1 rounded-sm px-2 py-1 text-2xs transition-colors ${
                                    active
                                        ? 'bg-background text-foreground shadow-sm'
                                        : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                {opt.label}
                            </button>
                        );
                    })}
                </div>
                <p className="text-2xs text-muted-foreground">
                    {visualStyleOptions.find((o) => o.value === styleMode)?.desc}
                </p>
            </div>

            {/* Text density slider */}
            <div className="space-y-1 pt-1.5">
                <Label className="flex items-center gap-1.5 text-2xs">
                    <TypeIcon className="size-3.5 text-muted-foreground" />
                    {t('visualPreferences.textDensityLabel')}
                </Label>
                <div className="flex w-full rounded-md border bg-muted p-0.5">
                    {textDensityOptions.map((opt) => {
                        const active = textDensity === opt.value;
                        return (
                            <button
                                key={opt.value}
                                type="button"
                                onClick={() => setDensity(opt.value)}
                                title={opt.desc}
                                className={`flex-1 rounded-sm px-2 py-1 text-2xs transition-colors ${
                                    active
                                        ? 'bg-background text-foreground shadow-sm'
                                        : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                {opt.label}
                            </button>
                        );
                    })}
                </div>
                <p className="text-2xs text-muted-foreground">
                    {textDensityOptions.find((o) => o.value === textDensity)?.desc}
                </p>
                {showCaptionsHint && (
                    <p className="flex items-start gap-1 rounded bg-amber-500/10 px-1.5 py-1 text-2xs text-amber-700 dark:text-amber-400">
                        <Captions className="mt-0.5 size-3 shrink-0" />
                        <span>
                            <Trans
                                i18nKey="videoApiStudioSettingsPopover:visualPreferences.captionsHint"
                                components={{ strong: <strong /> }}
                            />
                        </span>
                    </p>
                )}
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────
// HostTabBody — on-screen narrator config (Host feature, ultra+ only).
// Mirrors the BE `HostConfig` schema in app/schemas/video_generation.py.
// Tier-gated UX: when quality_tier is below ultra, controls render disabled
// with a clear "upgrade to ultra" hint instead of being hidden — matches
// the answer captured during planning.
// ─────────────────────────────────────────────────────────────────────────
function HostTabBody({
    options,
    onOptionsChange,
    vimMode = false,
}: {
    options: Omit<GenerateVideoRequest, 'prompt'>;
    onOptionsChange: (options: Omit<GenerateVideoRequest, 'prompt'>) => void;
    vimMode?: boolean;
}) {
    const { t } = useTranslation(['videoApiStudioSettingsPopover', 'videoApiStudioCredits']);
    const tier = options.quality_tier || 'ultra';
    const tierAllowed = tier === 'ultra' || tier === 'super_ultra';
    const host = options.host;
    const hostEnabled = !!host;
    // Avatar models are billed in USD/sec internally; render in credits/sec
    // using the live rate from `credit_rate_config` (falls back to the seed
    // 150× when the rate endpoint is unreachable).
    const ratio = useEffectiveCreditRatio();

    const { uploadFile, getPublicUrl, isUploading } = useFileUpload();
    const [uploadError, setUploadError] = useState<string | null>(null);
    // Snapshot of the resolved provider for the picked saved avatar — drives
    // which fields render (custom shows details/model; argil/veed hide both
    // because their endpoint + identity are fixed by the catalog enum).
    const [pickedAvatar, setPickedAvatar] = useState<StudioAvatar | null>(null);

    /** Replace the entire `host` block on options. */
    const setHost = (next: HostConfig | undefined) => {
        onOptionsChange({ ...options, host: next });
    };

    /** Patch the host.avatar sub-block. */
    const patchAvatar = (patch: Partial<NonNullable<HostConfig['avatar']>>) => {
        if (!host || host.type !== 'avatar') return;
        setHost({
            ...host,
            avatar: { ...(host.avatar || {}), ...patch },
        });
    };

    const handleEnableToggle = (on: boolean) => {
        if (on) {
            // Default to avatar with Kling at 480p, 100% on screen.
            setHost({
                type: 'avatar',
                host_in_video_percentage: 100,
                avatar: {
                    face_image_url: '',
                    details_prompt: '',
                    avatar_model: 'fal-ai/kling-video/ai-avatar/v2/standard',
                    quality: '480p',
                },
            });
        } else {
            setHost(undefined);
        }
    };

    const handleFileSelect = async (file: File | null) => {
        if (!file) return;
        setUploadError(null);
        if (!file.type.startsWith('image/')) {
            setUploadError(t('host.faceUpload.errors.invalidType'));
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            setUploadError(t('host.faceUpload.errors.tooLarge'));
            return;
        }
        try {
            const fileId = await uploadFile({
                file,
                setIsUploading: () => {},
                userId: getUserId(),
                source: 'AVATAR_FACES',
                sourceId: 'ADMIN',
                publicUrl: true,
            });
            if (!fileId) throw new Error(t('host.faceUpload.errors.uploadFailed'));
            const url = await getPublicUrl(fileId);
            if (!url) throw new Error(t('host.faceUpload.errors.noPublicUrl'));
            patchAvatar({ face_image_url: url });
        } catch (err) {
            const msg =
                err instanceof Error ? err.message : t('host.faceUpload.errors.uploadFailed');
            setUploadError(msg);
            toast.error(t('host.faceUpload.errors.toast', { message: msg }));
        }
    };

    // Locked / upgrade-required state — show controls but disabled.
    if (!tierAllowed) {
        return (
            <div className="space-y-3">
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
                    <div className="mb-1 flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
                        <LockIcon className="size-3.5" />
                        {t('host.locked.title')}
                    </div>
                    <p className="text-muted-foreground">
                        <Trans
                            i18nKey="videoApiStudioSettingsPopover:host.locked.description"
                            components={{
                                ultra: <span className="font-medium" />,
                                superUltra: <span className="font-medium" />,
                            }}
                        />
                    </p>
                </div>
                {/* If a host config was previously enabled on a higher tier,
                    surface a clear button — otherwise the user submits and
                    discovers their host config is invalid via a 400 error. */}
                {hostEnabled && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs">
                        <div className="mb-1 font-medium text-destructive">
                            {t('host.staleConfig.title')}
                        </div>
                        <p className="mb-2 text-muted-foreground">
                            {t('host.staleConfig.description')}
                        </p>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-2xs"
                            onClick={() => setHost(undefined)}
                        >
                            <XIcon className="size-3" />
                            {t('host.staleConfig.clearButton')}
                        </Button>
                    </div>
                )}
                {/* Disabled preview of the controls */}
                <div className="pointer-events-none space-y-3 opacity-50">
                    <div className="flex items-center justify-between">
                        <Label className="flex items-center gap-1.5 text-xs">
                            <UserIcon className="size-3.5 text-muted-foreground" />
                            {t('host.enableToggle.label')}
                        </Label>
                        <Switch checked={false} />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {/* Master toggle */}
            <div className="space-y-1">
                <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1.5 text-xs">
                        <UserIcon className="size-3.5 text-muted-foreground" />
                        {t('host.enableToggle.label')}
                    </Label>
                    <Switch checked={hostEnabled} onCheckedChange={handleEnableToggle} />
                </div>
                <p className="ps-5 text-2xs text-muted-foreground">
                    {t('host.enableToggle.helper', {
                        rate: formatCredits(usdToCredits(0.0562, ratio), {
                            precision: 1,
                            suffix: '',
                            t,
                        }),
                    })}
                </p>
            </div>

            {hostEnabled && host && (
                <>
                    {/* Type selector: avatar | raw (raw is plumbed but disabled in v1) */}
                    <Field icon={<Wand2 className="size-3.5" />} label={t('host.hostType.label')}>
                        <div className="inline-flex w-full rounded-lg border bg-muted p-0.5">
                            {(
                                [
                                    { value: 'avatar', label: t('host.hostType.avatar') },
                                    { value: 'raw', label: t('host.hostType.raw') },
                                ] as const
                            ).map(({ value, label }) => {
                                const disabled = value === 'raw';
                                const active = host.type === value;
                                return (
                                    <button
                                        key={value}
                                        type="button"
                                        disabled={disabled}
                                        onClick={() =>
                                            setHost({
                                                ...host,
                                                type: value as HostType,
                                                avatar:
                                                    value === 'avatar'
                                                        ? host.avatar || {
                                                              face_image_url: '',
                                                              avatar_model:
                                                                  'fal-ai/kling-video/ai-avatar/v2/standard',
                                                              quality: '480p',
                                                              details_prompt: '',
                                                          }
                                                        : undefined,
                                                raw:
                                                    value === 'raw'
                                                        ? host.raw || { input_video_ids: [] }
                                                        : undefined,
                                            })
                                        }
                                        className={`relative inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                                            active
                                                ? 'bg-background text-foreground shadow-sm'
                                                : disabled
                                                  ? 'cursor-not-allowed text-muted-foreground/50'
                                                  : 'text-muted-foreground hover:text-foreground'
                                        }`}
                                    >
                                        {label}
                                        {disabled && (
                                            <Badge
                                                variant="outline"
                                                className="h-4 px-1 text-2xs uppercase"
                                            >
                                                {t('host.hostType.soonBadge')}
                                            </Badge>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </Field>

                    {host.type === 'avatar' && (
                        <>
                            {vimMode ? (
                                <>
                                    {/* Saved-avatar picker (vim only). The picked id flows into
                                       host.avatar.saved_avatar_id; BE resolves provider + face +
                                       voice from the saved row. We snapshot the avatar locally so
                                       we can hide details_prompt + avatar_model when the resolved
                                       provider is built-in (their endpoint is fixed). */}
                                    <Field
                                        icon={<UserIcon className="size-3.5" />}
                                        label={t('host.avatarPicker.label')}
                                        helper={t('host.avatarPicker.helper')}
                                    >
                                        <VimSavedAvatarSelect
                                            value={host.avatar?.saved_avatar_id}
                                            onChange={(avatarId, avatar) => {
                                                setPickedAvatar(avatar ?? null);
                                                // Clear free-form fields when picking a saved
                                                // avatar — BE resolution overrides them anyway,
                                                // but a stale face_image_url / avatar_model in
                                                // the request is confusing in curl dumps and
                                                // BE logs (looks like Kling is being used when
                                                // a built-in catalog avatar is actually routed).
                                                //
                                                // For built-in catalog avatars (argil / veed),
                                                // also drop avatar_model + details_prompt — they
                                                // have no effect on those endpoints (provider
                                                // owns the route, the catalog enum owns identity).
                                                // For custom saved avatars we keep avatar_model
                                                // so the user can still pick Kling vs Fabric.
                                                const isBuiltin =
                                                    !!avatar && avatar.provider !== 'custom';
                                                patchAvatar({
                                                    saved_avatar_id: avatarId,
                                                    face_image_url: undefined,
                                                    ...(isBuiltin
                                                        ? {
                                                              avatar_model: undefined,
                                                              details_prompt: '',
                                                          }
                                                        : {}),
                                                });
                                            }}
                                        />
                                    </Field>

                                    {/* Voice override toggle (vim only). When the saved avatar
                                       carries voice metadata, this is the opt-out switch — off
                                       keeps the request's voice fields, on (default) lets BE
                                       apply the avatar's saved voice. Hidden when no avatar
                                       picked (the toggle is meaningless without an avatar). */}
                                    {host.avatar?.saved_avatar_id && (
                                        <div className="space-y-1">
                                            <div className="flex items-center justify-between">
                                                <Label className="flex items-center gap-1.5 text-xs">
                                                    <Mic className="size-3.5 text-muted-foreground" />
                                                    {t('host.useSavedVoice.label')}
                                                </Label>
                                                <Switch
                                                    checked={host.avatar.use_avatar_voice ?? true}
                                                    onCheckedChange={(v) =>
                                                        patchAvatar({ use_avatar_voice: v })
                                                    }
                                                />
                                            </div>
                                            <p className="ps-5 text-2xs text-muted-foreground">
                                                {t('host.useSavedVoice.helper')}
                                            </p>
                                        </div>
                                    )}

                                    {/* Custom-only fields. For Argil / VEED catalog avatars the
                                       persona is locked by the enum, so details_prompt + the
                                       avatar_model dropdown don't apply. */}
                                    {pickedAvatar?.provider === 'custom' && (
                                        <>
                                            <Field
                                                icon={<TypeIcon className="size-3.5" />}
                                                label={t('host.details.label')}
                                                helper={t('host.details.helper')}
                                            >
                                                <Textarea
                                                    value={host.avatar?.details_prompt || ''}
                                                    onChange={(e) =>
                                                        patchAvatar({
                                                            details_prompt: e.target.value,
                                                        })
                                                    }
                                                    placeholder={t('host.details.placeholder')}
                                                    rows={2}
                                                    className="resize-none text-xs"
                                                />
                                            </Field>
                                            <Field
                                                icon={<Film className="size-3.5" />}
                                                label={t('host.avatarModel.label')}
                                            >
                                                <Select
                                                    value={
                                                        host.avatar?.avatar_model ||
                                                        'fal-ai/kling-video/ai-avatar/v2/standard'
                                                    }
                                                    onValueChange={(v) =>
                                                        patchAvatar({
                                                            avatar_model: v as AvatarModel,
                                                        })
                                                    }
                                                >
                                                    <SelectTrigger className="h-8 text-xs">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {buildAvatarModels(t).map((m) => (
                                                            <SelectItem
                                                                key={m.value}
                                                                value={m.value}
                                                                className="text-xs"
                                                            >
                                                <div className="flex flex-col">
                                                                    <span>{m.label}</span>
                                                                    <span className="text-2xs text-muted-foreground">
                                                                        {t(
                                                                            'host.avatarModel.creditsPerSec',
                                                                            {
                                                                                credits: formatCredits(
                                                                                    usdToCredits(
                                                                                        m.perSecondUsd,
                                                                                        ratio
                                                                                    ),
                                                                                    {
                                                                                        precision: 1,
                                                                                        suffix: '',
                                                                                        t,
                                                                                    }
                                                                                ),
                                                                            }
                                                                        )}
                                                                    </span>
                                                                </div>
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </Field>
                                        </>
                                    )}
                                </>
                            ) : (
                                <>
                                    {/* Face image dropzone with preview */}
                                    <Field
                                        icon={<UploadIcon className="size-3.5" />}
                                        label={t('host.faceUpload.label')}
                                        helper={t('host.faceUpload.helper')}
                                    >
                                        {host.avatar?.face_image_url ? (
                                            <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-2">
                                                <img
                                                    src={host.avatar.face_image_url}
                                                    alt={t('host.faceUpload.faceAlt')}
                                                    className="size-16 shrink-0 rounded-md object-cover"
                                                />
                                                <div className="flex-1 space-y-1">
                                                    <div className="break-all text-2xs text-muted-foreground">
                                                        {host.avatar.face_image_url
                                                            .split('/')
                                                            .pop()
                                                            ?.slice(0, 40)}
                                                    </div>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-6 px-2 text-2xs"
                                                        onClick={() =>
                                                            patchAvatar({ face_image_url: '' })
                                                        }
                                                    >
                                                        <XIcon className="size-3" />
                                                        {t('host.faceUpload.replace')}
                                                    </Button>
                                                </div>
                                            </div>
                                        ) : (
                                            <label
                                                htmlFor="host-face-upload"
                                                className="flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed bg-muted/30 px-3 py-4 text-xs text-muted-foreground hover:bg-muted/50"
                                            >
                                                {isUploading ? (
                                                    <>
                                                        <Loader2 className="size-4 animate-spin" />
                                                        <span>{t('host.faceUpload.uploading')}</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <UploadIcon className="size-4" />
                                                        <span>{t('host.faceUpload.dropHint')}</span>
                                                    </>
                                                )}
                                                <input
                                                    id="host-face-upload"
                                                    type="file"
                                                    accept="image/*"
                                                    className="hidden"
                                                    onChange={(e) =>
                                                        handleFileSelect(
                                                            e.target.files?.[0] ?? null
                                                        )
                                                    }
                                                />
                                            </label>
                                        )}
                                        {uploadError && (
                                            <p className="text-2xs text-destructive">
                                                {uploadError}
                                            </p>
                                        )}
                                    </Field>

                                    {/* Details prompt */}
                                    <Field
                                        icon={<TypeIcon className="size-3.5" />}
                                        label={t('host.details.label')}
                                        helper={t('host.details.helper')}
                                    >
                                        <Textarea
                                            value={host.avatar?.details_prompt || ''}
                                            onChange={(e) =>
                                                patchAvatar({ details_prompt: e.target.value })
                                            }
                                            placeholder={t('host.details.placeholder')}
                                            rows={2}
                                            className="resize-none text-xs"
                                        />
                                    </Field>

                                    {/* Model picker */}
                                    <Field
                                        icon={<Film className="size-3.5" />}
                                        label={t('host.avatarModel.label')}
                                    >
                                        <Select
                                            value={
                                                host.avatar?.avatar_model ||
                                                'fal-ai/kling-video/ai-avatar/v2/standard'
                                            }
                                            onValueChange={(v) =>
                                                patchAvatar({ avatar_model: v as AvatarModel })
                                            }
                                        >
                                            <SelectTrigger className="h-8 text-xs">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {buildAvatarModels(t).map((m) => (
                                                    <SelectItem
                                                        key={m.value}
                                                        value={m.value}
                                                        className="text-xs"
                                                    >
                                                        <div className="flex flex-col">
                                                            <span>{m.label}</span>
                                                            <span className="text-2xs text-muted-foreground">
                                                                {t(
                                                                    'host.avatarModel.creditsPerSec',
                                                                    {
                                                                        credits: formatCredits(
                                                                            usdToCredits(
                                                                                m.perSecondUsd,
                                                                                ratio
                                                                            ),
                                                                            {
                                                                                precision: 1,
                                                                                suffix: '',
                                                                                t,
                                                                            }
                                                                        ),
                                                                    }
                                                                )}
                                                            </span>
                                                        </div>
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </Field>
                                </>
                            )}

                            {/* Quality picker */}
                            <Field
                                icon={<Monitor className="size-3.5" />}
                                label={t('host.quality.label')}
                                helper={t('host.quality.helper')}
                            >
                                <div className="inline-flex w-full rounded-lg border bg-muted p-0.5">
                                    {(['480p', '720p'] as const).map((q) => {
                                        const active = (host.avatar?.quality || '480p') === q;
                                        return (
                                            <button
                                                key={q}
                                                type="button"
                                                onClick={() =>
                                                    patchAvatar({ quality: q as AvatarQuality })
                                                }
                                                className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                                                    active
                                                        ? 'bg-background text-foreground shadow-sm'
                                                        : 'text-muted-foreground hover:text-foreground'
                                                }`}
                                            >
                                                {q}
                                            </button>
                                        );
                                    })}
                                </div>
                            </Field>

                            {/* FPS — only for audio-to-video models that expose it (LTX 2.3).
                               Hidden for the dedicated lip-sync avatars + built-ins. */}
                            {host.avatar?.avatar_model ===
                                'fal-ai/ltx-2.3-quality/audio-to-video' && (
                                <Field
                                    icon={<Film className="size-3.5" />}
                                    label={t('host.fps.label')}
                                    helper={t('host.fps.helper')}
                                >
                                    <Select
                                        value={String(host.avatar?.avatar_fps ?? 24)}
                                        onValueChange={(v) =>
                                            patchAvatar({ avatar_fps: Number(v) })
                                        }
                                    >
                                        <SelectTrigger className="h-8 text-xs">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {[24, 30, 48, 60].map((f) => (
                                                <SelectItem
                                                    key={f}
                                                    value={String(f)}
                                                    className="text-xs"
                                                >
                                                    {t('host.fps.value', { fps: f })}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </Field>
                            )}

                            {/* Host-in-video percentage */}
                            <Field
                                icon={<Users className="size-3.5" />}
                                label={t('host.percentage.label', {
                                    percent: host.host_in_video_percentage,
                                })}
                                helper={t('host.percentage.helper')}
                            >
                                <Slider
                                    value={[host.host_in_video_percentage]}
                                    min={5}
                                    max={100}
                                    step={5}
                                    onValueChange={(v) =>
                                        setHost({ ...host, host_in_video_percentage: v[0] ?? 100 })
                                    }
                                />
                                <p className="text-2xs text-muted-foreground">
                                    {t('host.percentage.tip')}
                                </p>
                            </Field>
                        </>
                    )}
                </>
            )}
        </div>
    );
}

function ThemeCard({
    label,
    description,
    previewHtml,
    primaryColor,
    selected,
    onSelect,
}: {
    label: string;
    description?: string;
    previewHtml?: string;
    primaryColor?: string;
    selected: boolean;
    onSelect: () => void;
}) {
    const { t } = useTranslation('videoApiStudioSettingsPopover');
    // Inject the user's primary color via CSS custom properties so previews
    // reflect the live color choice (matches AiSettings template gallery).
    const srcDoc = previewHtml
        ? `<style>:root{--primary-color:${primaryColor || '#6366f1'};--accent-color:${primaryColor || '#6366f1'}}</style>${previewHtml}` // design-lint-ignore: portable literal default template color, not app theme (see EmbedCodeDialog.tsx precedent)
        : null;

    return (
        <button
            type="button"
            onClick={onSelect}
            className={`overflow-hidden rounded-md border-2 text-left transition-all ${
                selected
                    ? 'border-violet-500 ring-2 ring-violet-200'
                    : 'border-border hover:border-muted-foreground/40'
            }`}
        >
            <div className="relative h-24 w-full overflow-hidden bg-muted">
                {srcDoc ? (
                    <iframe
                        srcDoc={srcDoc}
                        title={label}
                        sandbox="allow-scripts"
                        className="pointer-events-none border-0"
                        style={{
                            width: '1920px',
                            height: '1080px',
                            transformOrigin: 'top left',
                            transform: 'scale(0.0833)', // 160 / 1920
                        }}
                    />
                ) : (
                    <div className="flex size-full items-center justify-center text-2xs text-muted-foreground">
                        {t('themeCard.minimalStyling')}
                    </div>
                )}
            </div>
            <div className="bg-background px-1.5 py-1">
                <p
                    className={`truncate text-2xs font-medium ${
                        selected ? 'text-violet-700' : 'text-foreground'
                    }`}
                >
                    {label}
                </p>
                {description && (
                    <p className="truncate text-2xs text-muted-foreground">{description}</p>
                )}
            </div>
        </button>
    );
}

function IntroOutroEditor({
    label,
    value,
    onChange,
}: {
    label: string;
    value: { enabled: boolean; duration_seconds: number; html: string };
    onChange: (next: { enabled: boolean; duration_seconds: number; html: string }) => void;
}) {
    const { t } = useTranslation('videoApiStudioSettingsPopover');
    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between">
                <Label className="text-xs font-medium">{label}</Label>
                <Switch
                    checked={value.enabled}
                    onCheckedChange={(v) => onChange({ ...value, enabled: v })}
                />
            </div>
            {value.enabled && (
                <div className="flex items-center gap-2 pl-1">
                    <Label className="text-2xs text-muted-foreground">
                        {t('introOutro.duration')}
                    </Label>
                    <Input
                        type="number"
                        min={1}
                        max={10}
                        step={0.5}
                        value={value.duration_seconds}
                        onChange={(e) =>
                            onChange({
                                ...value,
                                duration_seconds: Math.max(
                                    1,
                                    Math.min(10, Number(e.target.value) || 0)
                                ),
                            })
                        }
                        className="h-7 w-16 text-xs"
                    />
                    <span className="text-2xs text-muted-foreground">
                        {t('introOutro.seconds')}
                    </span>
                </div>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────
// BrandKitOverridePanel — per-video overrides layered on top of the selected
// brand kit (or institute defaults). One-shot: not persisted across videos.
//
// system_prompt REPLACES the kit's director instructions for this run; colors
// field-merge; intro / outro / watermark replace those sections. Each section
// is opt-in via a toggle so an untouched section falls through to the kit.
// Empty/cleared sections are pruned so the request omits brand_overrides when
// nothing is overridden.
// ─────────────────────────────────────────────────────────────────────────

function pruneBrandOverrides(ov: BrandOverrides): BrandOverrides | undefined {
    const out: BrandOverrides = {};
    if (ov.palette) {
        const p: BrandPalette = {};
        (['primary', 'secondary', 'accent', 'background'] as const).forEach((k) => {
            const v = ov.palette?.[k];
            if (typeof v === 'string' && v.trim()) p[k] = v.trim();
        });
        if (Object.keys(p).length) out.palette = p;
    }
    if (ov.intro) out.intro = ov.intro;
    if (ov.outro) out.outro = ov.outro;
    if (ov.watermark) out.watermark = ov.watermark;
    if (typeof ov.system_prompt === 'string' && ov.system_prompt.trim()) {
        out.system_prompt = ov.system_prompt;
    }
    return Object.keys(out).length ? out : undefined;
}

function BrandKitOverridePanel({
    value,
    selectedKit,
    onChange,
}: {
    value: BrandOverrides | undefined;
    selectedKit: BrandKit | undefined;
    onChange: (next: BrandOverrides | undefined) => void;
}) {
    const { t } = useTranslation(['videoApiStudioSettingsPopover', 'videoApiStudioVideoStyleBranding']);
    const watermarkPositions = buildWatermarkPositions(t);
    const ov = value ?? {};
    const active = hasActiveBrandOverrides(value);
    const [open, setOpen] = useState(active);

    // Merge a partial patch into the current overrides and prune empties.
    const set = (patch: BrandOverrides) =>
        onChange(pruneBrandOverrides({ ...ov, ...patch }));

    const setPalette = (key: keyof BrandPalette, hex: string) =>
        set({ palette: { ...ov.palette, [key]: hex } });

    const colorsOn = !!ov.palette;
    const introOn = !!ov.intro;
    const outroOn = !!ov.outro;
    const watermarkOn = !!ov.watermark;

    const toggleColors = (on: boolean) =>
        set({
            palette: on
                ? {
                      primary: selectedKit?.palette?.primary ?? '#FF6B00', // design-lint-ignore: portable literal default brand-kit color, not app theme
                      secondary: selectedKit?.palette?.secondary ?? '#0F172A', // design-lint-ignore: portable literal default brand-kit color, not app theme
                      accent: selectedKit?.palette?.accent ?? '#22D3EE', // design-lint-ignore: portable literal default brand-kit color, not app theme
                      background: selectedKit?.palette?.background ?? '#FFFFFF', // design-lint-ignore: portable literal default brand-kit color, not app theme
                  }
                : undefined,
        });

    const toggleIntro = (on: boolean) =>
        set({
            intro: on
                ? {
                      enabled: selectedKit?.intro?.enabled ?? true,
                      duration_seconds: selectedKit?.intro?.duration_seconds ?? 3,
                      html: selectedKit?.intro?.html ?? '',
                  }
                : undefined,
        });

    const toggleOutro = (on: boolean) =>
        set({
            outro: on
                ? {
                      enabled: selectedKit?.outro?.enabled ?? true,
                      duration_seconds: selectedKit?.outro?.duration_seconds ?? 4,
                      html: selectedKit?.outro?.html ?? '',
                  }
                : undefined,
        });

    const toggleWatermark = (on: boolean) =>
        set({
            watermark: on
                ? {
                      enabled: selectedKit?.watermark?.enabled ?? true,
                      position: selectedKit?.watermark?.position ?? 'bottom-right',
                      opacity: selectedKit?.watermark?.opacity ?? 0.5,
                      html: selectedKit?.watermark?.html ?? '',
                  }
                : undefined,
        });

    return (
        <details
            open={open}
            onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
            className="group rounded-md border bg-muted/30 [&_summary::-webkit-details-marker]:hidden"
        >
            <summary className="flex cursor-pointer list-none items-center justify-between px-2.5 py-2 text-xs font-medium">
                <span className="flex items-center gap-1.5">
                    <SparklesIcon className="size-3.5 text-muted-foreground" />
                    {t('brandOverride.title')}
                    {active && <span className="size-1.5 rounded-full bg-violet-500" />}
                </span>
                <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="space-y-3 border-t p-2.5">
                <p className="text-2xs leading-snug text-muted-foreground">
                    {t('brandOverride.intro')}
                </p>

                {/* System prompt — replaces the kit's director instructions */}
                <div className="space-y-1">
                    <Label className="text-2xs uppercase tracking-wide text-muted-foreground">
                        {t('brandOverride.directorInstructions.label')}
                    </Label>
                    <Textarea
                        rows={3}
                        maxLength={4000}
                        placeholder={
                            selectedKit?.system_prompt
                                ? t('brandOverride.directorInstructions.placeholderReplace')
                                : t('brandOverride.directorInstructions.placeholderDefault')
                        }
                        value={ov.system_prompt ?? ''}
                        onChange={(e) => set({ system_prompt: e.target.value })}
                        className="text-xs"
                    />
                    <p className="text-2xs text-muted-foreground">
                        {t('brandOverride.directorInstructions.helper')}
                    </p>
                </div>

                {/* Colors */}
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium">
                            {t('brandOverride.colors.label')}
                        </Label>
                        <Switch checked={colorsOn} onCheckedChange={toggleColors} />
                    </div>
                    {colorsOn && (
                        <div className="grid grid-cols-2 gap-2 pl-1">
                            {(
                                [
                                    ['primary', t('brandOverride.colors.primary')],
                                    ['secondary', t('brandOverride.colors.secondary')],
                                    ['accent', t('brandOverride.colors.accent')],
                                    ['background', t('brandOverride.colors.background')],
                                ] as const
                            ).map(([key, label]) => (
                                <div key={key} className="space-y-1">
                                    <Label className="text-2xs uppercase tracking-wide text-muted-foreground">
                                        {label}
                                    </Label>
                                    <div className="flex items-center gap-1.5">
                                        <ColorPicker
                                            value={ov.palette?.[key] ?? '#000000'} // design-lint-ignore: portable literal ColorPicker fallback, not app theme
                                            onChange={(color) => setPalette(key, color)}
                                        />
                                        <span className="font-mono text-2xs text-muted-foreground">
                                            {ov.palette?.[key] ?? ''}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Intro */}
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium">
                            {t('brandOverride.overrideIntro')}
                        </Label>
                        <Switch checked={introOn} onCheckedChange={toggleIntro} />
                    </div>
                    {introOn && ov.intro && (
                        <div className="space-y-1.5 pl-1">
                            <IntroOutroEditor
                                label={t('introOutro.intro')}
                                value={{
                                    enabled: ov.intro.enabled ?? true,
                                    duration_seconds: ov.intro.duration_seconds ?? 3,
                                    html: ov.intro.html ?? '',
                                }}
                                onChange={(next) => set({ intro: next })}
                            />
                            <Textarea
                                rows={2}
                                placeholder={t('brandOverride.introPlaceholder')}
                                value={ov.intro.html ?? ''}
                                onChange={(e) =>
                                    set({ intro: { ...ov.intro, html: e.target.value } })
                                }
                                className="font-mono text-2xs"
                            />
                        </div>
                    )}
                </div>

                {/* Outro */}
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium">
                            {t('brandOverride.overrideOutro')}
                        </Label>
                        <Switch checked={outroOn} onCheckedChange={toggleOutro} />
                    </div>
                    {outroOn && ov.outro && (
                        <div className="space-y-1.5 pl-1">
                            <IntroOutroEditor
                                label={t('introOutro.outro')}
                                value={{
                                    enabled: ov.outro.enabled ?? true,
                                    duration_seconds: ov.outro.duration_seconds ?? 4,
                                    html: ov.outro.html ?? '',
                                }}
                                onChange={(next) => set({ outro: next })}
                            />
                            <Textarea
                                rows={2}
                                placeholder={t('brandOverride.outroPlaceholder')}
                                value={ov.outro.html ?? ''}
                                onChange={(e) =>
                                    set({ outro: { ...ov.outro, html: e.target.value } })
                                }
                                className="font-mono text-2xs"
                            />
                        </div>
                    )}
                </div>

                {/* Watermark */}
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium">
                            {t('brandOverride.overrideWatermark')}
                        </Label>
                        <Switch checked={watermarkOn} onCheckedChange={toggleWatermark} />
                    </div>
                    {watermarkOn && ov.watermark && (
                        <div className="space-y-1.5 pl-1">
                            <div className="flex items-center justify-between">
                                <Label className="text-2xs text-muted-foreground">
                                    {t('brandOverride.show')}
                                </Label>
                                <Switch
                                    checked={ov.watermark.enabled ?? true}
                                    onCheckedChange={(v) =>
                                        set({ watermark: { ...ov.watermark, enabled: v } })
                                    }
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-1">
                                {watermarkPositions.map((p) => (
                                    <button
                                        key={p.value}
                                        type="button"
                                        onClick={() =>
                                            set({
                                                watermark: {
                                                    ...ov.watermark,
                                                    position: p.value as WatermarkPosition,
                                                },
                                            })
                                        }
                                        className={`rounded-md border px-2 py-1 text-2xs transition-colors ${
                                            ov.watermark?.position === p.value
                                                ? 'border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'
                                                : 'hover:bg-muted'
                                        }`}
                                    >
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                            <Textarea
                                rows={2}
                                placeholder={t('brandOverride.watermarkPlaceholder')}
                                value={ov.watermark.html ?? ''}
                                onChange={(e) =>
                                    set({ watermark: { ...ov.watermark, html: e.target.value } })
                                }
                                className="font-mono text-2xs"
                            />
                        </div>
                    )}
                </div>

                {active && (
                    <button
                        type="button"
                        onClick={() => onChange(undefined)}
                        className="text-2xs text-muted-foreground hover:text-foreground hover:underline"
                    >
                        {t('brandOverride.clearAll')}
                    </button>
                )}
            </div>
        </details>
    );
}

// ─────────────────────────────────────────────────────────────────────────
// ModelOverridesPanel — V200 per-stage user model overrides
//
// One simple control: "Default model" dropdown. Picking a model mass-applies
// to every user-overridable stage (ShotPlanner, NarrationWriter, per-shot
// HTML, act planner, regen HTML, plus v2-legacy script/director stages).
//
// Optional "Customize per stage" expander shows each overridable stage with
// its own dropdown — defaults to "inherits default" so the user only needs
// to touch the stages they care about.
//
// Vision review + utility prompts ignore this entirely (pinned to admin
// defaults in the DB matrix). The hint below makes that explicit so users
// don't think they can wire e.g. Sonnet for the headline thumbnailer.
// ─────────────────────────────────────────────────────────────────────────

function ModelOverridesPanel({
    overrides,
    onChange,
}: {
    overrides: ModelOverrides | undefined;
    onChange: (next: ModelOverrides | undefined) => void;
}) {
    const { t } = useTranslation('videoApiStudioSettingsPopover');
    const [advancedOpen, setAdvancedOpen] = useState(false);
    // Fetch models eligible for video. Single shared query — TanStack
    // dedupes across the panel + every per-stage dropdown.
    const { data: modelsData, isLoading } = useAIModelsList({ use_case: 'video' });
    const models = modelsData?.models ?? [];

    const defaultModel = overrides?.default ?? '';
    const perStage = overrides?.per_stage ?? {};
    const SYSTEM_DEFAULT_VALUE = '__system_default__';

    // Drop entries with empty/whitespace strings so FE state matches what the
    // BE will accept after pydantic validation. Without this, a `{ shot_planner:
    // '' }` slot could survive in state, inflate the "settings count" badge,
    // and confuse history rehydration.
    const prunePerStage = (
        src: Partial<Record<UserOverridableStage, string>>
    ): Partial<Record<UserOverridableStage, string>> => {
        const out: Partial<Record<UserOverridableStage, string>> = {};
        (Object.keys(src) as UserOverridableStage[]).forEach((k) => {
            const v = src[k];
            if (typeof v === 'string' && v.trim()) out[k] = v.trim();
        });
        return out;
    };

    const setDefault = (model: string | undefined) => {
        const cleanedPerStage = prunePerStage(perStage);
        const hasPerStage = Object.keys(cleanedPerStage).length > 0;
        if (!model) {
            // Clearing default — if no per-stage entries either, drop the
            // whole object so the request body omits `model_overrides`
            // entirely (admin defaults apply everywhere).
            onChange(hasPerStage ? { per_stage: cleanedPerStage } : undefined);
            return;
        }
        onChange({
            default: model,
            ...(hasPerStage ? { per_stage: cleanedPerStage } : {}),
        });
    };

    const setPerStage = (stage: UserOverridableStage, model: string | undefined) => {
        const next: Partial<Record<UserOverridableStage, string>> = { ...perStage };
        if (model && model.trim()) {
            next[stage] = model.trim();
        } else {
            delete next[stage];
        }
        const cleaned = prunePerStage(next);
        const hasPerStage = Object.keys(cleaned).length > 0;
        if (!defaultModel && !hasPerStage) {
            onChange(undefined);
            return;
        }
        onChange({
            ...(defaultModel ? { default: defaultModel } : {}),
            ...(hasPerStage ? { per_stage: cleaned } : {}),
        });
    };

    return (
        <div className="space-y-3 rounded-md border border-border/60 bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-3">
                <Label className="flex items-center gap-1.5 text-xs font-medium">
                    <CpuIcon className="size-3.5" />
                    {t('modelOverrides.label')}
                </Label>
            </div>
            <p className="ps-5 text-2xs text-muted-foreground">
                {t('modelOverrides.description')}
            </p>
            <div className="space-y-1.5 pl-5">
                <Label className="text-2xs text-muted-foreground">
                    {t('modelOverrides.defaultModelLabel')}
                </Label>
                <Select
                    value={defaultModel || SYSTEM_DEFAULT_VALUE}
                    onValueChange={(v) => setDefault(v === SYSTEM_DEFAULT_VALUE ? undefined : v)}
                    disabled={isLoading}
                >
                    <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder={t('modelOverrides.systemDefault')} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={SYSTEM_DEFAULT_VALUE} className="text-xs">
                            {t('modelOverrides.systemDefault')}
                        </SelectItem>
                        {models.map((m) => (
                            <SelectItem key={m.model_id} value={m.model_id} className="text-xs">
                                {m.name}
                                <span className="ms-1 text-2xs text-muted-foreground">
                                    ({m.provider})
                                </span>
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <button
                type="button"
                onClick={() => setAdvancedOpen((v) => !v)}
                className="flex w-full items-center gap-1 ps-5 text-2xs text-muted-foreground hover:text-foreground"
            >
                <ChevronRightIcon
                    className={`size-3 transition-transform ${advancedOpen ? 'rotate-90' : ''}`}
                />
                {t('modelOverrides.advancedToggle')}
            </button>

            {advancedOpen && (
                <div className="space-y-2 rounded-md border border-border/40 bg-background/60 p-2 pl-5">
                    {buildUserOverridableStageMeta(t).map((stage) => {
                        const current = perStage[stage.value] ?? '';
                        return (
                            <div key={stage.value} className="space-y-1">
                                <Label className="text-2xs text-foreground/80">
                                    {stage.label}
                                    {stage.hint && (
                                        <span className="ms-1 text-2xs text-muted-foreground">
                                            — {stage.hint}
                                        </span>
                                    )}
                                </Label>
                                <Select
                                    value={current || SYSTEM_DEFAULT_VALUE}
                                    onValueChange={(v) =>
                                        setPerStage(
                                            stage.value,
                                            v === SYSTEM_DEFAULT_VALUE ? undefined : v
                                        )
                                    }
                                    disabled={isLoading}
                                >
                                    <SelectTrigger className="h-7 text-2xs">
                                        <SelectValue
                                            placeholder={
                                                defaultModel
                                                    ? t('modelOverrides.inheritsDefault', {
                                                          model: defaultModel,
                                                      })
                                                    : t('modelOverrides.inheritsSystemDefault')
                                            }
                                        />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem
                                            value={SYSTEM_DEFAULT_VALUE}
                                            className="text-2xs"
                                        >
                                            {defaultModel
                                                ? t('modelOverrides.inheritsDefault', {
                                                      model: defaultModel,
                                                  })
                                                : t('modelOverrides.inheritsSystemDefault')}
                                        </SelectItem>
                                        {models.map((m) => (
                                            <SelectItem
                                                key={m.model_id}
                                                value={m.model_id}
                                                className="text-2xs"
                                            >
                                                {m.name}
                                                <span className="ms-1 text-2xs text-muted-foreground">
                                                    ({m.provider})
                                                </span>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export function SettingsPopover(props: SettingsPopoverProps) {
    const { t } = useTranslation('videoApiStudioSettingsPopover');
    const [open, setOpen] = useState(false);
    const count = computeNonDefaultCount(props.options, props.reviewModeEnabled);

    // Reset options + reviewMode back to fresh defaults. Doesn't touch the
    // prompt or attachments — those are the user's "work".
    //
    // vimMode caveat: DEFAULT_OPTIONS.model is `''`, but in vimMode we want
    // the legacy top-level model field to stay absent from the wire payload
    // (P2-12 sunset). Setting `model: undefined` makes JSON.stringify drop
    // the key entirely. The two-step cast is needed because GenerateVideoRequest
    // types `model: string` as required; making it optional would propagate
    // through every call site — see "P2-12 follow-up" note in the plan file.
    const handleResetToDefaults = () => {
        if (props.vimMode) {
            props.onOptionsChange({
                ...DEFAULT_OPTIONS,
                model: undefined,
            } as unknown as Omit<GenerateVideoRequest, 'prompt'>);
        } else {
            props.onOptionsChange(DEFAULT_OPTIONS);
        }
        props.onReviewModeChange?.(false);
    };

    // Settings render in a slide-up Sheet rather than a Popover. Popovers were
    // getting clipped because the trigger sits low on the page and the panel
    // is tall (4 tabs × multiple fields). A Sheet from the bottom always has
    // 85vh of room, scrolls cleanly, and feels native on touch devices.
    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 bg-background text-xs font-normal hover:bg-muted"
                    title={t('sheet.triggerTitle')}
                >
                    <Settings2 className="size-3.5" />
                    <span className="hidden sm:inline">{t('sheet.triggerLabel')}</span>
                    {count > 0 && (
                        <Badge
                            variant="default"
                            className="h-4 min-w-4 justify-center px-1 text-2xs"
                        >
                            {count}
                        </Badge>
                    )}
                </Button>
            </SheetTrigger>
            <SheetContent
                side="bottom"
                className="flex max-h-dialog-tall flex-col gap-0 rounded-t-xl p-0"
            >
                <SheetTitle className="flex items-center justify-between gap-3 border-b px-4 py-3 text-sm font-semibold">
                    <span>{t('sheet.title')}</span>
                    {count > 0 && (
                        <button
                            type="button"
                            onClick={handleResetToDefaults}
                            className="text-xs font-normal text-muted-foreground transition-colors hover:text-foreground"
                            title={t('sheet.resetTitle')}
                        >
                            {t('sheet.resetToDefaults')}
                        </button>
                    )}
                </SheetTitle>
                <div className="mx-auto w-full max-w-lg flex-1 overflow-y-auto p-4">
                    <SettingsBody {...props} />
                </div>
            </SheetContent>
        </Sheet>
    );
}


// ─────────────────────────────────────────────────────────────────────────
// CastPicker — reuse a saved storybook/drama cast (same faces + voices).
// Fetches once per mount; renders nothing heavier than a compact select.
// ─────────────────────────────────────────────────────────────────────────
function CastPicker({
    apiKey,
    castId,
    onChange,
}: {
    apiKey?: string;
    castId?: string;
    onChange: (castId: string | undefined) => void;
}) {
    const { t } = useTranslation('videoApiStudioSettingsPopover');
    const [casts, setCasts] = useState<VideoCast[]>([]);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        if (!apiKey || loaded) return;
        let cancelled = false;
        listCasts(apiKey)
            .then((c) => {
                if (!cancelled) {
                    setCasts(c);
                    setLoaded(true);
                }
            })
            .catch(() => {
                if (!cancelled) setLoaded(true);
            });
        return () => {
            cancelled = true;
        };
    }, [apiKey, loaded]);

    if (loaded && casts.length === 0) {
        return (
            <p className="text-2xs text-muted-foreground">
                {t('advanced.castPicker.noSavedCasts')}
            </p>
        );
    }

    return (
        <div className="flex items-center gap-1.5">
            <span className="text-2xs text-muted-foreground">
                {t('advanced.castPicker.label')}
            </span>
            <select
                value={castId ?? ''}
                onChange={(e) => onChange(e.target.value || undefined)}
                aria-label={t('advanced.castPicker.savedCastAria')}
                className="h-6 flex-1 rounded-md border bg-background px-1.5 text-2xs text-foreground outline-none"
            >
                <option value="">{t('advanced.castPicker.newCast')}</option>
                {casts.map((c) => (
                    <option key={c.cast_id} value={c.cast_id}>
                        {c.name} ·{' '}
                        {t('advanced.castPicker.characterCount', {
                            count: c.characters.length,
                        })}
                    </option>
                ))}
            </select>
        </div>
    );
}
