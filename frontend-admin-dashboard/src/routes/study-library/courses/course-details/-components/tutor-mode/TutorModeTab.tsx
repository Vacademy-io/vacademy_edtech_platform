import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
    ArrowsClockwise,
    ChalkboardTeacher,
    CircleNotch,
    Eye,
    FloppyDisk,
    Sparkle,
    WarningCircle,
} from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { MyButton } from '@/components/design-system/button';
import { getPackageSettingData, savePackageSettingKey } from '@/services/package-settings';
import {
    TUTOR_MODE_SETTING_KEY,
    TUTOR_TTS_PROVIDERS,
    TUTOR_VOICE_PACES,
    compileTutorPlans,
    getInstituteTutorDefaults,
    getTutorOptions,
    getTutorPlans,
    getTutorSlidePlan,
    newCompileRunId,
    putTutorSourceDescription,
    recompileTutorSlide,
    type TutorCompileEvent,
    type TutorCompileOptions,
    type TutorModeSetting,
    type TutorOptions,
    type TutorPackagePlans,
    type TutorPlanStatus,
    type TutorPlanStatusItem,
} from '@/services/tutor';
import { TutorPlanPreviewDialog } from './TutorPlanPreviewDialog';
import { TutorCompileEstimateDialog } from './TutorCompileEstimateDialog';
import { TutorInsightsCard } from '@/components/common/tutor/TutorInsightsCard';
import { TeacherPresenceField } from '@/components/common/tutor/TeacherPresenceField';
import { ModelPicker, VoicePicker } from '@/components/common/tutor/TutorPickers';
import { useTranslation } from 'react-i18next';

interface TutorModeTabProps {
    packageId: string;
}

/**
 * Per-course fields start EMPTY: anything left blank inherits the institute
 * default at runtime (settings.py `pick()` skips empty values), so the tab
 * must never write hard-coded values over what the institute chose.
 */
const EMPTY_SETTING: TutorModeSetting = {
    enabled: false,
    defaultOn: true,
    teacherName: '',
    ttsVoice: '',
    llmModel: '',
    compileModel: '',
};

/** Built-in fallbacks when the institute never saved its defaults. */
const PLATFORM_DEFAULTS: Required<
    Pick<
        TutorModeSetting,
        | 'teacherName'
        | 'ttsProvider'
        | 'languages'
        | 'sessionLanguage'
        | 'strictness'
        | 'generateImages'
    >
> = {
    teacherName: 'Asha',
    ttsProvider: 'sarvam',
    languages: ['en', 'hi'],
    sessionLanguage: 'course',
    strictness: 'normal',
    generateImages: true,
};

/** Radix Select cannot carry an empty value: this sentinel means "inherit". */
const INHERIT = '__inherit__';

const StatusBadge: React.FC<{ status: TutorPlanStatus | string }> = ({ status }) => {
    const { t } = useTranslation('studyLibraryTutorModeTab');
    const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
        READY: {
            label: t('statusLabel.ready'),
            tone: 'bg-success-50 text-success-700 border-success-200',
        },
        COMPILING: {
            label: t('statusLabel.compiling'),
            tone: 'bg-primary-50 text-primary-600 border-primary-200',
        },
        NEEDS_DETAILS: {
            label: t('statusLabel.needsDetails'),
            tone: 'bg-warning-50 text-warning-700 border-warning-200',
        },
        STALE: {
            label: t('statusLabel.stale'),
            tone: 'bg-warning-50 text-warning-700 border-warning-200',
        },
        FAILED: {
            label: t('statusLabel.failed'),
            tone: 'bg-danger-50 text-danger-700 border-danger-200',
        },
        NOT_COMPILED: {
            label: t('statusLabel.notCompiled'),
            tone: 'bg-neutral-100 text-neutral-600 border-neutral-200',
        },
        UNSUPPORTED: {
            label: t('statusLabel.unsupported'),
            tone: 'bg-neutral-100 text-neutral-500 border-neutral-200',
        },
        DELETED: {
            label: t('statusLabel.deleted'),
            tone: 'bg-neutral-100 text-neutral-500 border-neutral-200',
        },
    };
    const s = STATUS_LABEL[status] ?? {
        label: status,
        tone: 'bg-neutral-100 text-neutral-600 border-neutral-200',
    };
    return (
        <Badge variant="outline" className={s.tone}>
            {s.label}
        </Badge>
    );
};

const isMediaSlide = (t: string | null) => t === 'VIDEO' || t === 'HTML_VIDEO' || t === 'DOCUMENT';

/** Drop empty strings / undefined so the saved object only carries real overrides. */
const stripEmpty = (s: TutorModeSetting): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s)) {
        if (v === undefined || v === null) continue;
        if (typeof v === 'string' && v.trim() === '') continue;
        if (Array.isArray(v) && v.length === 0) continue;
        out[k] = v;
    }
    return out;
};

/**
 * Course page → Tutor Mode tab (docs/ai-tutor/LIVE_TUTOR_DESIGN.md §5.3, BUILD_PLAN WP3).
 *
 * Two cards: the per-course TUTOR_MODE_SETTING (enable, default on, teacher,
 * voice, models — blanks inherit the institute defaults shown as placeholders)
 * and the teaching-plan status of every slide with "Prepare for teaching"
 * (compiles what is missing or stale), per-slide recompile, a "what this
 * video / PDF teaches" editor for slides parked in NEEDS_DETAILS, and a
 * read-only preview of any compiled plan.
 */
export const TutorModeTab: React.FC<TutorModeTabProps> = ({ packageId }) => {
    const { t } = useTranslation('studyLibraryTutorModeTab');
    const SOURCE_KIND_LABEL: Record<string, string> = useMemo(
        () => ({
            document: t('sourceKindLabel.document'),
            pdf: t('sourceKindLabel.pdf'),
            quiz: t('sourceKindLabel.quiz'),
            ai_video: t('sourceKindLabel.aiVideo'),
            youtube: t('sourceKindLabel.youtube'),
            video_upload: t('sourceKindLabel.videoUpload'),
            video_link: t('sourceKindLabel.videoLink'),
            scorm: t('sourceKindLabel.scorm'),
            other: t('sourceKindLabel.other'),
        }),
        [t]
    );
    const TEXT_KIND_LABEL: Record<string, string> = useMemo(
        () => ({
            script: t('textKindLabel.script'),
            captions: t('textKindLabel.captions'),
            transcript: t('textKindLabel.transcript'),
            pdf: t('textKindLabel.pdf'),
            scorm: t('textKindLabel.scorm'),
            scorm_ocr: t('textKindLabel.scormOcr'),
        }),
        [t]
    );
    // ── settings ──
    const [setting, setSetting] = useState<TutorModeSetting>(EMPTY_SETTING);
    const [institute, setInstitute] = useState<TutorModeSetting | null>(null);
    const [options, setOptions] = useState<TutorOptions | null>(null);
    const [settingLoading, setSettingLoading] = useState(true);
    const [settingSaving, setSettingSaving] = useState(false);
    const [dirty, setDirty] = useState(false);

    // ── plans ──
    const [plans, setPlans] = useState<TutorPackagePlans | null>(null);
    const [plansLoading, setPlansLoading] = useState(true);
    const [compiling, setCompiling] = useState(false);
    const [progress, setProgress] = useState<Record<string, TutorCompileEvent>>({});
    const [previewSlide, setPreviewSlide] = useState<TutorPlanStatusItem | null>(null);
    const [detailsFor, setDetailsFor] = useState<TutorPlanStatusItem | null>(null);
    const [detailsText, setDetailsText] = useState('');
    const [detailsLoading, setDetailsLoading] = useState(false);
    const [detailsSaving, setDetailsSaving] = useState(false);
    const abortRef = useRef<AbortController | null>(null);

    // Effective values (course override → institute default → platform default), for placeholders and compiles.
    const inherited = useMemo(
        () => ({
            teacherName: institute?.teacherName || PLATFORM_DEFAULTS.teacherName,
            ttsProvider: institute?.ttsProvider || PLATFORM_DEFAULTS.ttsProvider,
            ttsVoice: institute?.ttsVoice || '',
            languages: institute?.languages?.length
                ? institute.languages
                : PLATFORM_DEFAULTS.languages,
            sessionLanguage: institute?.sessionLanguage || PLATFORM_DEFAULTS.sessionLanguage,
            strictness: institute?.strictness || PLATFORM_DEFAULTS.strictness,
            llmModel: institute?.llmModel || '',
            compileModel: institute?.compileModel || '',
            generateImages: institute?.generateImages !== false,
            voicePace: typeof institute?.voicePace === 'number' ? institute.voicePace : 1,
            teacherAvatarFileId: institute?.teacherAvatarFileId || '',
            avatarId: institute?.avatarProvider === 'spatius' ? institute?.avatarId || '' : '',
        }),
        [institute]
    );
    const effectiveLanguage = (setting.languages?.[0] ?? inherited.languages[0] ?? 'en') as
        | 'en'
        | 'hi';
    const effectiveImages = setting.generateImages ?? inherited.generateImages;

    const loadSetting = useCallback(async () => {
        setSettingLoading(true);
        try {
            const [pkg, inst] = await Promise.all([
                getPackageSettingData(packageId, TUTOR_MODE_SETTING_KEY).catch(() => null),
                getInstituteTutorDefaults().catch(() => null),
            ]);
            setInstitute(inst);
            if (pkg && typeof pkg === 'object')
                setSetting({ ...EMPTY_SETTING, ...(pkg as TutorModeSetting) });
        } finally {
            setSettingLoading(false);
        }
    }, [packageId]);

    const loadPlans = useCallback(async () => {
        setPlansLoading(true);
        try {
            setPlans(await getTutorPlans(packageId));
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : t('toast.loadPlansFailed'));
        } finally {
            setPlansLoading(false);
        }
    }, [packageId]);

    useEffect(() => {
        void loadSetting();
        void loadPlans();
        getTutorOptions()
            .then(setOptions)
            .catch(() => setOptions(null));
        return () => abortRef.current?.abort();
    }, [loadSetting, loadPlans]);

    const update = <K extends keyof TutorModeSetting>(key: K, value: TutorModeSetting[K]) => {
        setSetting((s) => ({ ...s, [key]: value }));
        setDirty(true);
    };
    const selectValue = (v: string | undefined) => v || INHERIT;
    const fromSelect = (v: string) => (v === INHERIT ? undefined : v);

    const saveSetting = async () => {
        setSettingSaving(true);
        try {
            await savePackageSettingKey(
                packageId,
                TUTOR_MODE_SETTING_KEY,
                stripEmpty(setting),
                'Tutor Mode'
            );
            setDirty(false);
            toast.success(t('toast.settingsSaved'));
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : t('toast.saveSettingsFailed'));
        } finally {
            setSettingSaving(false);
        }
    };

    const onEvent = useCallback((ev: TutorCompileEvent) => {
        if (ev.slide_id) setProgress((p) => ({ ...p, [ev.slide_id as string]: ev }));
        if (ev.type === 'ERROR') toast.error(ev.message || t('toast.compileError'));
    }, []);

    // Show what the compile will cost (per slide) before spending credits.
    const [estimateFor, setEstimateFor] = useState<{ slideIds?: string[] } | null>(null);
    const [transcribeVideos, setTranscribeVideos] = useState(true);
    const [ocrPdfs, setOcrPdfs] = useState(true);

    const compileOptions = (): TutorCompileOptions => {
        // Only explicit course overrides travel with the request; the
        // server fills the rest (model, KB grounding, images, teacher)
        // from the course → institute → platform settings.
        const opts: TutorCompileOptions = {
            language: effectiveLanguage,
            compile_run_id: newCompileRunId(),
            transcribe_videos: transcribeVideos,
            ocr_pdfs: ocrPdfs,
        };
        if (setting.teacherName?.trim()) opts.teacher_name = setting.teacherName.trim();
        if (typeof setting.generateImages === 'boolean')
            opts.generate_images = setting.generateImages;
        if (setting.kbGrounding?.knowledge_base_id) opts.kb_grounding = setting.kbGrounding;
        return opts;
    };

    const runCompile = async (slideIds?: string[]) => {
        if (compiling) {
            toast.info(t('toast.compileAlreadyRunning'));
            return;
        }
        setCompiling(true);
        setProgress({});
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            const opts = compileOptions();
            if (slideIds && slideIds.length === 1) {
                await recompileTutorSlide(slideIds[0]!, opts, onEvent, controller.signal);
            } else {
                await compileTutorPlans(
                    packageId,
                    { ...opts, slide_ids: slideIds ?? [] },
                    onEvent,
                    controller.signal
                );
            }
            toast.success(t('toast.plansUpdated'));
        } catch (e: unknown) {
            if (e instanceof DOMException && e.name === 'AbortError') {
                toast.info(t('toast.stoppedWatching'));
            } else {
                toast.error(e instanceof Error ? e.message : t('toast.compileFailed'));
            }
        } finally {
            setCompiling(false);
            abortRef.current = null;
            void loadPlans();
        }
    };

    const openDetails = (s: TutorPlanStatusItem) => {
        setDetailsFor(s);
        setDetailsText('');
        setDetailsLoading(true);
        getTutorSlidePlan(s.slide_id, true)
            .then((p) => setDetailsText(p.source_description || ''))
            .catch(() => {
                /* no plan yet: start blank */
            })
            .finally(() => setDetailsLoading(false));
    };

    const saveDetails = async () => {
        if (!detailsFor) return;
        setDetailsSaving(true);
        try {
            await putTutorSourceDescription(detailsFor.slide_id, detailsText.trim());
            toast.success(t('toast.detailsSaved'));
            const id = detailsFor.slide_id;
            setDetailsFor(null);
            setDetailsText('');
            await runCompile([id]);
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : t('toast.saveDetailsFailed'));
        } finally {
            setDetailsSaving(false);
        }
    };

    const counts = plans?.counts ?? {};
    const supported = useMemo(
        () => (plans?.slides ?? []).filter((s) => s.status !== 'UNSUPPORTED'),
        [plans]
    );
    const pending = useMemo(
        () =>
            supported.filter((s) => ['NOT_COMPILED', 'STALE', 'FAILED'].includes(s.status)).length,
        [supported]
    );
    const needsDetails = useMemo(
        () => supported.filter((s) => s.status === 'NEEDS_DETAILS'),
        [supported]
    );
    const ready = (counts.READY ?? 0) + (counts.STALE ?? 0);

    return (
        <div className="space-y-4 p-2">
            {/* ── settings ── */}
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <ChalkboardTeacher className="size-5 text-primary-500" />
                        {t('settingsCard.title')}
                        {settingLoading && (
                            <CircleNotch className="size-4 animate-spin text-neutral-400" />
                        )}
                    </CardTitle>
                    <p className="text-sm text-neutral-500">
                        {t('settingsCard.description')}
                    </p>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex flex-wrap gap-6">
                        <label className="flex items-center gap-2 text-sm">
                            <Switch
                                checked={!!setting.enabled}
                                onCheckedChange={(v) => update('enabled', v)}
                            />
                            {t('settingsCard.tutorEnabled')}
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                            <Switch
                                checked={!!setting.defaultOn}
                                disabled={!setting.enabled}
                                onCheckedChange={(v) => update('defaultOn', v)}
                            />
                            {t('settingsCard.startInTeachingMode')}
                        </label>
                        <label
                            className="flex items-center gap-2 text-sm"
                            title={t('settingsCard.aiImagesTooltip')}
                        >
                            <Switch
                                checked={effectiveImages}
                                onCheckedChange={(v) => update('generateImages', v)}
                            />
                            {t('settingsCard.aiImagesLabel')}
                            {setting.generateImages === undefined && (
                                <span className="text-xs text-neutral-400">
                                    {t('settingsCard.instituteDefaultTag')}
                                </span>
                            )}
                        </label>
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <div className="space-y-1">
                            <Label>{t('settingsCard.teacherNameLabel')}</Label>
                            <Input
                                value={setting.teacherName ?? ''}
                                maxLength={60}
                                placeholder={inherited.teacherName}
                                onChange={(e) => update('teacherName', e.target.value)}
                            />
                        </div>
                        <div className="space-y-1">
                            <Label>{t('settingsCard.courseLanguageLabel')}</Label>
                            <Select
                                value={selectValue(setting.languages?.[0])}
                                onValueChange={(v) => {
                                    const lang = fromSelect(v);
                                    update(
                                        'languages',
                                        lang ? [lang, lang === 'en' ? 'hi' : 'en'] : undefined
                                    );
                                }}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={INHERIT}>
                                        {t('settingsCard.instituteDefaultWithValue', {
                                            value:
                                                inherited.languages[0] === 'hi'
                                                    ? t('settingsCard.languageHindi')
                                                    : t('settingsCard.languageEnglish'),
                                        })}
                                    </SelectItem>
                                    <SelectItem value="en">
                                        {t('settingsCard.languageEnglish')}
                                    </SelectItem>
                                    <SelectItem value="hi">
                                        {t('settingsCard.languageHindi')}
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <Label>{t('settingsCard.sessionLanguageLabel')}</Label>
                            <Select
                                value={selectValue(setting.sessionLanguage)}
                                onValueChange={(v) =>
                                    update(
                                        'sessionLanguage',
                                        fromSelect(v) as TutorModeSetting['sessionLanguage']
                                    )
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={INHERIT}>
                                        {t('settingsCard.instituteDefaultWithValue', {
                                            value:
                                                inherited.sessionLanguage === 'learner'
                                                    ? t('settingsCard.sessionLanguageLearnerPref')
                                                    : t('settingsCard.sessionLanguageCourse'),
                                        })}
                                    </SelectItem>
                                    <SelectItem value="course">
                                        {t('settingsCard.sessionLanguageCourseOption')}
                                    </SelectItem>
                                    <SelectItem value="learner">
                                        {t('settingsCard.sessionLanguageLearnerOption')}
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <Label>{t('settingsCard.voiceProviderLabel')}</Label>
                            <Select
                                value={selectValue(setting.ttsProvider)}
                                onValueChange={(v) =>
                                    update(
                                        'ttsProvider',
                                        fromSelect(v) as TutorModeSetting['ttsProvider']
                                    )
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={INHERIT}>
                                        {t('settingsCard.instituteDefaultWithValue', {
                                            value:
                                                TUTOR_TTS_PROVIDERS.find(
                                                    (p) => p.value === inherited.ttsProvider
                                                )?.label.split(' (')[0] ?? inherited.ttsProvider,
                                        })}
                                    </SelectItem>
                                    {TUTOR_TTS_PROVIDERS.map((p) => (
                                        <SelectItem key={p.value} value={p.value}>
                                            {p.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <Label>{t('settingsCard.voiceLabel')}</Label>
                            <VoicePicker
                                value={setting.ttsVoice || undefined}
                                onChange={(v) => update('ttsVoice', v ?? '')}
                                provider={setting.ttsProvider || inherited.ttsProvider}
                                voices={
                                    options?.voices?.[
                                        setting.ttsProvider || inherited.ttsProvider
                                    ] ?? []
                                }
                                inheritLabel={
                                    inherited.ttsVoice
                                        ? t('settingsCard.instituteDefaultWithValue', {
                                              value: inherited.ttsVoice,
                                          })
                                        : t('settingsCard.instituteDefaultVoiceFallback')
                                }
                            />
                        </div>
                        <div className="space-y-1">
                            <Label>{t('settingsCard.strictnessLabel')}</Label>
                            <Select
                                value={selectValue(setting.strictness)}
                                onValueChange={(v) =>
                                    update(
                                        'strictness',
                                        fromSelect(v) as TutorModeSetting['strictness']
                                    )
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={INHERIT}>
                                        {t('settingsCard.instituteDefaultWithValue', {
                                            value: inherited.strictness,
                                        })}
                                    </SelectItem>
                                    <SelectItem value="gentle">
                                        {t('settingsCard.strictnessGentle')}
                                    </SelectItem>
                                    <SelectItem value="normal">
                                        {t('settingsCard.strictnessNormal')}
                                    </SelectItem>
                                    <SelectItem value="strict">
                                        {t('settingsCard.strictnessStrict')}
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <Label>{t('settingsCard.voicePaceLabel')}</Label>
                            <Select
                                value={
                                    typeof setting.voicePace === 'number'
                                        ? String(setting.voicePace)
                                        : INHERIT
                                }
                                onValueChange={(v) =>
                                    update('voicePace', v === INHERIT ? undefined : Number(v))
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={INHERIT}>
                                        {t('settingsCard.instituteDefaultWithValue', {
                                            value:
                                                TUTOR_VOICE_PACES.find(
                                                    (p) => p.value === inherited.voicePace
                                                )?.label ??
                                                t('settingsCard.paceValue', {
                                                    value: inherited.voicePace,
                                                }),
                                        })}
                                    </SelectItem>
                                    {TUTOR_VOICE_PACES.map((p) => (
                                        <SelectItem key={p.value} value={String(p.value)}>
                                            {p.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <Label>{t('settingsCard.liveModelLabel')}</Label>
                            <ModelPicker
                                value={setting.llmModel || undefined}
                                onChange={(v) => update('llmModel', v ?? '')}
                                models={options?.models ?? []}
                                inheritLabel={
                                    inherited.llmModel
                                        ? t('settingsCard.instituteDefaultWithValue', {
                                              value: inherited.llmModel,
                                          })
                                        : t('settingsCard.instituteOrPlatformDefault')
                                }
                            />
                        </div>
                        <div className="space-y-1">
                            <Label>{t('settingsCard.compileModelLabel')}</Label>
                            <ModelPicker
                                value={setting.compileModel || undefined}
                                onChange={(v) => update('compileModel', v ?? '')}
                                models={options?.models ?? []}
                                inheritLabel={
                                    inherited.compileModel
                                        ? t('settingsCard.instituteDefaultWithValue', {
                                              value: inherited.compileModel,
                                          })
                                        : t('settingsCard.instituteOrPlatformDefault')
                                }
                            />
                        </div>
                    </div>
                    <TeacherPresenceField
                        fileId={setting.teacherAvatarFileId || undefined}
                        inheritedFileId={inherited.teacherAvatarFileId || undefined}
                        teacherName={setting.teacherName || inherited.teacherName}
                        provider={setting.avatarProvider}
                        avatarId={setting.avatarId}
                        inheritedAvatarId={inherited.avatarId}
                        options={options}
                        inheritable
                        onFaceChange={(id) => update('teacherAvatarFileId', id)}
                        onAvatarChange={(provider, avatarId) => {
                            update('avatarProvider', provider);
                            update('avatarId', avatarId);
                        }}
                    />
                    {setting.kbGrounding?.knowledge_base_id && (
                        <p className="text-xs text-neutral-500">
                            {t('settingsCard.kbGroundedNote', {
                                id: setting.kbGrounding.knowledge_base_id,
                                mode: setting.kbGrounding.mode ?? 'STRICT',
                            })}
                        </p>
                    )}
                    <div className="flex justify-end">
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            layoutVariant="default"
                            disable={!dirty || settingSaving}
                            onClick={() => void saveSetting()}
                        >
                            {settingSaving ? (
                                <CircleNotch className="size-4 animate-spin" />
                            ) : (
                                <FloppyDisk className="size-4" />
                            )}
                            {t('settingsCard.saveSettings')}
                        </MyButton>
                    </div>
                </CardContent>
            </Card>

            {/* ── plans ── */}
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                        <Sparkle className="size-5 text-primary-500" />
                        {t('plansCard.title')}
                        {plansLoading && (
                            <CircleNotch className="size-4 animate-spin text-neutral-400" />
                        )}
                        <span className="ms-auto flex flex-wrap gap-1">
                            {Object.entries(counts).map(([k, v]) => (
                                <span key={k} className="inline-flex items-center gap-1 text-xs">
                                    <StatusBadge status={k} /> {v}
                                </span>
                            ))}
                        </span>
                    </CardTitle>
                    <p className="text-sm text-neutral-500">
                        {t('plansCard.readySummary', { ready, total: supported.length })}
                        {pending > 0 &&
                            t('plansCard.pendingSummary', { count: pending })}
                        {needsDetails.length > 0 &&
                            t('plansCard.needsDetailsSummary', { count: needsDetails.length })}
                    </p>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            layoutVariant="default"
                            disable={compiling || plansLoading}
                            onClick={() => setEstimateFor({})}
                        >
                            {compiling ? (
                                <CircleNotch className="size-4 animate-spin" />
                            ) : (
                                <Sparkle className="size-4" />
                            )}
                            {compiling ? t('plansCard.preparing') : t('plansCard.prepareForTeaching')}
                        </MyButton>
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            layoutVariant="default"
                            disable={compiling || plansLoading}
                            onClick={() => void loadPlans()}
                        >
                            <ArrowsClockwise className="size-4" /> {t('plansCard.refresh')}
                        </MyButton>
                        {compiling && (
                            <MyButton
                                buttonType="secondary"
                                scale="medium"
                                layoutVariant="default"
                                onClick={() => abortRef.current?.abort()}
                            >
                                {t('plansCard.stopWatching')}
                            </MyButton>
                        )}
                        <span className="text-xs text-neutral-500">
                            {t('plansCard.prepareHelpText')}
                        </span>
                    </div>

                    {detailsFor && (
                        <div className="space-y-2 rounded-md border border-warning-200 bg-warning-50 p-3">
                            <Label className="text-sm font-medium">
                                {t('detailsPanel.questionTitle', {
                                    title: detailsFor.slide_title,
                                })}
                                {detailsLoading && (
                                    <CircleNotch className="ms-2 inline size-3 animate-spin" />
                                )}
                            </Label>
                            <p className="text-xs text-neutral-600">
                                {t('detailsPanel.helpText')}
                            </p>
                            <Textarea
                                value={detailsText}
                                rows={5}
                                maxLength={8000}
                                disabled={detailsLoading}
                                onChange={(e) => setDetailsText(e.target.value)}
                            />
                            <div className="flex flex-wrap items-center gap-2">
                                <MyButton
                                    buttonType="primary"
                                    scale="small"
                                    layoutVariant="default"
                                    disable={
                                        detailsText.trim().length < 10 ||
                                        detailsSaving ||
                                        detailsLoading ||
                                        compiling
                                    }
                                    onClick={() => void saveDetails()}
                                >
                                    {detailsSaving ? (
                                        <CircleNotch className="size-4 animate-spin" />
                                    ) : null}
                                    {t('detailsPanel.saveAndPrepare')}
                                </MyButton>
                                <MyButton
                                    buttonType="secondary"
                                    scale="small"
                                    layoutVariant="default"
                                    onClick={() => setDetailsFor(null)}
                                >
                                    {t('detailsPanel.cancel')}
                                </MyButton>
                                {compiling && (
                                    <span className="text-xs text-neutral-500">
                                        {t('detailsPanel.waitForCompile')}
                                    </span>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-neutral-200 text-start text-xs uppercase tracking-wide text-neutral-500">
                                    <th className="py-2 pe-3">{t('plansCard.table.chapter')}</th>
                                    <th className="py-2 pe-3">{t('plansCard.table.slide')}</th>
                                    <th className="py-2 pe-3">{t('plansCard.table.type')}</th>
                                    <th className="py-2 pe-3">{t('plansCard.table.status')}</th>
                                    <th className="py-2 pe-3">{t('plansCard.table.plan')}</th>
                                    <th className="py-2 pe-3 text-end">{t('plansCard.table.actions')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(plans?.slides ?? []).map((s) => {
                                    const live = progress[s.slide_id];
                                    const liveStatus =
                                        live?.type === 'PLAN_STARTED'
                                            ? 'COMPILING'
                                            : live?.type === 'PLAN_READY'
                                              ? 'READY'
                                              : live?.type === 'PLAN_ERROR'
                                                ? 'FAILED'
                                                : live?.type === 'PLAN_NEEDS_DETAILS'
                                                  ? 'NEEDS_DETAILS'
                                                  : null;
                                    // Live events only override the fetched status while the
                                    // stream is open; after Stop / Refresh the server is right.
                                    const status = compiling && liveStatus ? liveStatus : s.status;
                                    return (
                                        <tr
                                            key={s.slide_id}
                                            className="border-b border-neutral-100 align-top"
                                        >
                                            <td className="py-2 pe-3 text-neutral-600">
                                                {s.chapter_name ?? '—'}
                                            </td>
                                            <td className="py-2 pe-3 font-medium text-neutral-800">
                                                {s.slide_title ?? s.slide_id}
                                                {(s.error || live?.error) && (
                                                    <p className="mt-0.5 flex items-start gap-1 text-xs font-normal text-danger-600">
                                                        <WarningCircle className="mt-0.5 size-3 shrink-0" />
                                                        {live?.error ?? s.error}
                                                    </p>
                                                )}
                                                {!s.error && !live?.error && !!s.quality_notes?.length && (
                                                    <p className="mt-0.5 flex items-start gap-1 text-xs font-normal text-warning-700">
                                                        <WarningCircle className="mt-0.5 size-3 shrink-0" />
                                                        <span>
                                                            {t('plans.qualityNotes', {
                                                                defaultValue: 'Teachable, with notes:',
                                                            })}{' '}
                                                            {s.quality_notes.slice(0, 2).join(' · ')}
                                                            {s.quality_notes.length > 2
                                                                ? ` · +${s.quality_notes.length - 2}`
                                                                : ''}
                                                        </span>
                                                    </p>
                                                )}
                                                {live?.reason && compiling && (
                                                    <p className="mt-0.5 text-xs font-normal text-neutral-500">
                                                        {live.reason}
                                                    </p>
                                                )}
                                            </td>
                                            <td className="py-2 pe-3 text-neutral-600">
                                                {SOURCE_KIND_LABEL[s.source_kind ?? ''] ??
                                                    s.source_type ??
                                                    '—'}
                                            </td>
                                            <td className="py-2 pe-3">
                                                <StatusBadge status={status} />
                                            </td>
                                            <td className="py-2 pe-3 text-neutral-600">
                                                {s.topics > 0
                                                    ? `${t('plansCard.boardsCount', {
                                                          count: s.topics,
                                                      })} · ${t('plansCard.conceptsCount', {
                                                          count: s.concepts,
                                                      })}`
                                                    : '—'}
                                                {s.version ? (
                                                    <span className="text-neutral-400">
                                                        {' '}
                                                        · v{s.version}
                                                    </span>
                                                ) : null}
                                                {s.text_kind ? (
                                                    <span className="block text-xs text-neutral-400">
                                                        {t('plansCard.fromTextKind', {
                                                            kind:
                                                                TEXT_KIND_LABEL[s.text_kind] ??
                                                                s.text_kind,
                                                        })}
                                                    </span>
                                                ) : null}
                                            </td>
                                            <td className="py-2 pe-0 text-end">
                                                <div className="flex justify-end gap-1">
                                                    {s.serving_plan_id && (
                                                        <button
                                                            type="button"
                                                            className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-primary-600"
                                                            title={t('plansCard.previewPlanTitle')}
                                                            onClick={() => setPreviewSlide(s)}
                                                        >
                                                            <Eye className="size-4" />
                                                        </button>
                                                    )}
                                                    {(s.status === 'NEEDS_DETAILS' ||
                                                        (isMediaSlide(s.source_type) &&
                                                            s.source_type !== 'DOCUMENT')) && (
                                                        <button
                                                            type="button"
                                                            className="rounded-md px-2 py-1 text-xs text-warning-700 hover:bg-warning-50"
                                                            onClick={() => openDetails(s)}
                                                        >
                                                            {s.status === 'NEEDS_DETAILS'
                                                                ? t('plansCard.addDetails')
                                                                : t('plansCard.editDetails')}
                                                        </button>
                                                    )}
                                                    {s.status !== 'UNSUPPORTED' && (
                                                        <button
                                                            type="button"
                                                            className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-primary-600 disabled:opacity-50"
                                                            title={t('plansCard.recompileSlideTitle')}
                                                            disabled={compiling}
                                                            onClick={() =>
                                                                setEstimateFor({
                                                                    slideIds: [s.slide_id],
                                                                })
                                                            }
                                                        >
                                                            <ArrowsClockwise className="size-4" />
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {!plansLoading && (plans?.slides ?? []).length === 0 && (
                                    <tr>
                                        <td
                                            colSpan={6}
                                            className="py-6 text-center text-neutral-500"
                                        >
                                            {t('plansCard.noSlidesYet')}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>

            <TutorInsightsCard packageId={packageId} />

            <TutorCompileEstimateDialog
                packageId={packageId}
                slideIds={estimateFor?.slideIds}
                open={estimateFor !== null}
                options={estimateFor ? compileOptions() : null}
                transcribeVideos={transcribeVideos}
                onTranscribeVideosChange={setTranscribeVideos}
                ocrPdfs={ocrPdfs}
                onOcrPdfsChange={setOcrPdfs}
                onClose={() => setEstimateFor(null)}
                onConfirm={() => {
                    const ids = estimateFor?.slideIds;
                    setEstimateFor(null);
                    void runCompile(ids);
                }}
            />

            <TutorPlanPreviewDialog
                slideId={previewSlide?.slide_id ?? null}
                slideTitle={previewSlide?.slide_title}
                onClose={() => setPreviewSlide(null)}
            />
        </div>
    );
};
