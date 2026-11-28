import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { MyButton } from '@/components/design-system/button';
import {
    ArrowCounterClockwise,
    FloppyDisk,
    Plus,
    Sparkle,
    Trash,
    UploadSimple,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL, GET_INSITITUTE_SETTINGS } from '@/constants/urls';
import { getInstituteId } from '@/constants/helper';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { getPublicUrl, UploadFileInS3 } from '@/services/upload_file';
import { getUserId } from '@/utils/userDetails';

/**
 * Student AI (learner chatbot) configuration, persisted as the institute's
 * `CHATBOT_SETTING`. Extracted from AiSettings so the same form can be reached
 * from Settings -> AI -> Student AI and from LMS -> Student AI -> Settings.
 */
/**
 * Ships with the product: the avatar the learner chatbot uses when an institute
 * has not uploaded its own icon. Kept in sync with DEFAULT_CHATBOT_SETTINGS in
 * the learner app (src/services/chatbot-settings.ts).
 */
export const DEFAULT_CHATBOT_AVATAR_URL =
    'https://res.cloudinary.com/dwtmtd0oz/image/upload/t_chatbot/chatbot-avatar_xsyf0n';

/**
 * Images the icon uploader accepts; anything else is rejected client-side.
 * SVG is deliberately excluded — uploads are served byte-for-byte from the
 * public bucket with their own Content-Type, so a scripted SVG would be stored
 * XSS the moment that bucket is fronted by an institute's own CDN domain.
 */
const AVATAR_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export interface TutorConfiguration {
    enable: boolean;
    role: string;
    assistant_name: string;
    institute_name: string;
    /**
     * Chatbot icon — either a direct image URL or a media-service file id. The
     * learner app resolves file ids and falls back to the default avatar when
     * this is empty.
     */
    avatarUrl?: string;
    core_instruction: string;
    hard_rules: string[];
    adherence_settings: {
        level: 'strict' | 'moderate' | 'flexible';
        temperature: number;
    };
    enabled_modes?: string[];
    chatbot_pages?: string[]; // Array of enabled page category keys
    /**
     * Whether the learner chatbot header shows the gear that opens the learner
     * app's /ai-settings page (API keys and token spend). Off for everyone
     * unless an institute deliberately turns it on.
     */
    show_ai_settings_shortcut?: boolean;
    voice_settings?: {
        default_language: string;
        default_voice: string;
    };
    // Floating launcher (FAB) behavior on the student app
    launcher_settings?: {
        draggable?: boolean;
        nudge_enabled?: boolean;
        nudge_interval_seconds?: number;
        nudge_duration_seconds?: number;
        bounce?: boolean;
    };
}

export const StudentAiSettingsSection = () => {
    const { t } = useTranslation('settingsStudentAi');
    const instituteId = getInstituteId();
    const instituteDetails = useInstituteDetailsStore((state) => state.instituteDetails);
    const [isSavingTutor, setIsSavingTutor] = useState(false);
    const [newHardRule, setNewHardRule] = useState('');
    const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
    // The stored value may be a media-service file id, so keep the displayable
    // URL separate from what we persist.
    const [avatarPreview, setAvatarPreview] = useState(DEFAULT_CHATBOT_AVATAR_URL);
    const avatarInputRef = useRef<HTMLInputElement>(null);
    const [tutorConfig, setTutorConfig] = useState<TutorConfiguration>({
        enable: false,
        role: 'Tutor',
        assistant_name: instituteDetails?.institute_name
            ? `${instituteDetails.institute_name} Chatbot`
            : 'Vacademy Chatbot',
        institute_name: instituteDetails?.institute_name || 'Vacademy',
        avatarUrl: DEFAULT_CHATBOT_AVATAR_URL,
        core_instruction: 'You are a helpful tutor assisting students with their doubts.',
        hard_rules: [
            'Never provide the final answer directly.',
            'Keep responses short and concise unless explaining a complex topic.',
        ],
        adherence_settings: {
            level: 'strict',
            temperature: 0.5,
        },
        enabled_modes: ['general', 'doubt', 'practice'],
        chatbot_pages: ['dashboard', 'all_courses', 'course_details', 'study_material'],
        show_ai_settings_shortcut: false,
        voice_settings: {
            default_language: 'en-IN',
            default_voice: 'shubh',
        },
        launcher_settings: {
            draggable: true,
            nudge_enabled: true,
            nudge_interval_seconds: 120,
            nudge_duration_seconds: 5,
            bounce: true,
        },
    });

    const fetchTutorSettings = useCallback(async () => {
        if (!instituteId) return;
        try {
            const response = await authenticatedAxiosInstance.get(GET_INSITITUTE_SETTINGS, {
                params: {
                    instituteId,
                    settingKey: 'CHATBOT_SETTING',
                },
            });
            if (response.data && response.data.data) {
                setTutorConfig((prev) => ({
                    ...prev,
                    ...response.data.data,
                }));
            }
        } catch (error) {
            console.error('Error fetching tutor settings:', error);
        }
    }, [instituteId]);

    useEffect(() => {
        fetchTutorSettings();
    }, [fetchTutorSettings]);

    // Resolve the stored icon into something an <img> can render: direct URLs
    // pass through, file ids are exchanged for a public URL.
    useEffect(() => {
        const stored = tutorConfig.avatarUrl?.trim();
        if (!stored) {
            setAvatarPreview(DEFAULT_CHATBOT_AVATAR_URL);
            return;
        }
        if (stored.startsWith('http://') || stored.startsWith('https://')) {
            setAvatarPreview(stored);
            return;
        }
        let cancelled = false;
        getPublicUrl(stored)
            .then((url) => {
                if (!cancelled) setAvatarPreview(url || DEFAULT_CHATBOT_AVATAR_URL);
            })
            .catch(() => {
                if (!cancelled) setAvatarPreview(DEFAULT_CHATBOT_AVATAR_URL);
            });
        return () => {
            cancelled = true;
        };
    }, [tutorConfig.avatarUrl]);

    const handleAvatarUpload = async (file: File | undefined) => {
        if (!file) return;
        if (!AVATAR_ACCEPTED_TYPES.includes(file.type)) {
            toast.error(t('avatar.invalidType'));
            return;
        }
        if (file.size > AVATAR_MAX_BYTES) {
            toast.error(t('avatar.tooLarge'));
            return;
        }
        setIsUploadingAvatar(true);
        try {
            const fileId = await UploadFileInS3(
                file,
                () => {},
                getUserId() || 'admin',
                'CHATBOT_AVATAR',
                'INSTITUTE',
                true
            );
            if (!fileId) throw new Error('Upload returned no file id');
            setTutorConfig((prev) => ({ ...prev, avatarUrl: fileId }));
            toast.success(t('avatar.uploaded'));
        } catch (error) {
            console.error('Error uploading chatbot avatar:', error);
            toast.error(t('avatar.uploadFailed'));
        } finally {
            setIsUploadingAvatar(false);
            if (avatarInputRef.current) avatarInputRef.current.value = '';
        }
    };

    // Institute details load asynchronously — seed the names once they arrive,
    // but never overwrite a name the admin has customised.
    useEffect(() => {
        if (instituteDetails?.institute_name) {
            setTutorConfig((prev) => ({
                ...prev,
                institute_name: instituteDetails.institute_name || 'Vacademy',
                assistant_name:
                    prev.assistant_name === 'Savir' || prev.assistant_name.endsWith(' Chatbot')
                        ? `${instituteDetails.institute_name} Chatbot`
                        : prev.assistant_name,
            }));
        }
    }, [instituteDetails]);

    const handleSaveTutorConfig = async () => {
        if (!instituteId) return;
        setIsSavingTutor(true);
        try {
            await authenticatedAxiosInstance.post(
                `${BASE_URL}/admin-core-service/institute/setting/v1/save-setting`,
                {
                    setting_name: 'AI Chatbot Configuration',
                    setting_data: {
                        enable: tutorConfig.enable,
                        role: tutorConfig.role,
                        assistant_name: tutorConfig.assistant_name,
                        institute_name: tutorConfig.institute_name,
                        avatarUrl: tutorConfig.avatarUrl || DEFAULT_CHATBOT_AVATAR_URL,
                        core_instruction: tutorConfig.core_instruction,
                        hard_rules: tutorConfig.hard_rules,
                        adherence_settings: {
                            level: tutorConfig.adherence_settings.level,
                            temperature: tutorConfig.adherence_settings.temperature,
                        },
                        enabled_modes: tutorConfig.enabled_modes,
                        chatbot_pages: tutorConfig.chatbot_pages,
                        show_ai_settings_shortcut:
                            tutorConfig.show_ai_settings_shortcut ?? false,
                        voice_settings: tutorConfig.voice_settings,
                        launcher_settings: tutorConfig.launcher_settings,
                    },
                },
                {
                    params: {
                        instituteId: instituteId,
                        settingKey: 'CHATBOT_SETTING',
                    },
                }
            );
            toast.success(t('toast.saveSuccess'));
            await fetchTutorSettings();
        } catch (error) {
            console.error('Error saving tutor configuration:', error);
            toast.error(t('toast.saveFailed'));
        } finally {
            setIsSavingTutor(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Student AI Configuration Card */}
            <Card className="border-indigo-100 shadow-sm">
                <CardHeader className="border-b border-indigo-50 bg-indigo-50/30">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="rounded-lg bg-indigo-500 p-2 text-white">
                                <Sparkle className="size-5" />
                            </div>
                            <div>
                                <CardTitle className="text-xl">{t('card.title')}</CardTitle>
                                <CardDescription>{t('card.description')}</CardDescription>
                            </div>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-6 pt-6">
                    <div className="space-y-4">
                        <div className="flex items-center gap-2">
                            <Label htmlFor="role" className="text-sm font-medium">
                                {t('fields.enable')}
                            </Label>
                            <Switch
                                id="enable"
                                checked={tutorConfig.enable}
                                onCheckedChange={(e) =>
                                    setTutorConfig({
                                        ...tutorConfig,
                                        enable: e,
                                    })
                                }
                            />
                        </div>
                        <div className="grid gap-6 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="role" className="text-sm font-medium">
                                    {t('fields.role')}
                                </Label>
                                <Input
                                    id="role"
                                    value={tutorConfig.role}
                                    onChange={(e) =>
                                        setTutorConfig({
                                            ...tutorConfig,
                                            role: e.target.value,
                                        })
                                    }
                                    placeholder={t('fields.rolePlaceholder')}
                                    className="border-indigo-100 focus:border-indigo-300"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="assistantName" className="text-sm font-medium">
                                    {t('fields.assistantName')}
                                </Label>
                                <Input
                                    id="assistantName"
                                    value={tutorConfig.assistant_name}
                                    onChange={(e) =>
                                        setTutorConfig({
                                            ...tutorConfig,
                                            assistant_name: e.target.value,
                                        })
                                    }
                                    placeholder={t('fields.assistantNamePlaceholder')}
                                    className="border-indigo-100 focus:border-indigo-300"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label className="text-sm font-medium">{t('avatar.label')}</Label>
                            <div className="flex flex-wrap items-center gap-4 rounded-lg border border-indigo-100 p-3">
                                <img
                                    src={avatarPreview}
                                    alt={t('avatar.previewAlt')}
                                    className="size-14 shrink-0 rounded-full border border-indigo-100 bg-white object-cover"
                                    onError={(e) => {
                                        e.currentTarget.src = DEFAULT_CHATBOT_AVATAR_URL;
                                    }}
                                />
                                <div className="flex flex-1 flex-col gap-2">
                                    <p className="text-xs text-muted-foreground">
                                        {t('avatar.helpText')}
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                        <input
                                            ref={avatarInputRef}
                                            type="file"
                                            accept={AVATAR_ACCEPTED_TYPES.join(',')}
                                            className="hidden"
                                            onChange={(e) =>
                                                handleAvatarUpload(e.target.files?.[0] ?? undefined)
                                            }
                                        />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            disabled={isUploadingAvatar}
                                            onClick={() => avatarInputRef.current?.click()}
                                            className="border-indigo-100 text-indigo-600 hover:bg-indigo-50"
                                        >
                                            <UploadSimple className="me-1 size-4" />
                                            {isUploadingAvatar
                                                ? t('avatar.uploading')
                                                : t('avatar.upload')}
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            disabled={
                                                isUploadingAvatar ||
                                                !tutorConfig.avatarUrl ||
                                                tutorConfig.avatarUrl === DEFAULT_CHATBOT_AVATAR_URL
                                            }
                                            onClick={() =>
                                                setTutorConfig({
                                                    ...tutorConfig,
                                                    avatarUrl: DEFAULT_CHATBOT_AVATAR_URL,
                                                })
                                            }
                                            className="border-indigo-100 text-neutral-600 hover:bg-indigo-50"
                                        >
                                            <ArrowCounterClockwise className="me-1 size-4" />
                                            {t('avatar.reset')}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="instituteName" className="text-sm font-medium">
                                {t('fields.instituteName')}
                            </Label>
                            <Input
                                id="instituteName"
                                value={tutorConfig.institute_name}
                                onChange={(e) =>
                                    setTutorConfig({
                                        ...tutorConfig,
                                        institute_name: e.target.value,
                                    })
                                }
                                className="border-indigo-100 focus:border-indigo-300"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="coreInstruction" className="text-sm font-medium">
                                {t('fields.coreInstruction')}
                            </Label>
                            <textarea
                                id="coreInstruction"
                                value={tutorConfig.core_instruction}
                                onChange={(e) =>
                                    setTutorConfig({
                                        ...tutorConfig,
                                        core_instruction: e.target.value,
                                    })
                                }
                                placeholder={t('fields.coreInstructionPlaceholder')}
                                rows={3}
                                className="w-full rounded-md border border-indigo-100 px-3 py-2 text-sm focus:border-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-100"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label className="text-sm font-medium">{t('hardRules.label')}</Label>
                            <div className="space-y-2">
                                {tutorConfig.hard_rules.map((rule, index) => (
                                    <div key={index} className="flex items-center gap-2">
                                        <Input
                                            value={rule}
                                            onChange={(e) => {
                                                const newRules = [...tutorConfig.hard_rules];
                                                newRules[index] = e.target.value;
                                                setTutorConfig({
                                                    ...tutorConfig,
                                                    hard_rules: newRules,
                                                });
                                            }}
                                            className="border-indigo-100 focus:border-indigo-300"
                                        />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon"
                                            onClick={() => {
                                                const newRules = tutorConfig.hard_rules.filter(
                                                    (_, i) => i !== index
                                                );
                                                setTutorConfig({
                                                    ...tutorConfig,
                                                    hard_rules: newRules,
                                                });
                                            }}
                                            className="border-red-200 text-red-600 hover:bg-red-50"
                                        >
                                            <Trash className="size-4" />
                                        </Button>
                                    </div>
                                ))}
                                <div className="flex gap-2">
                                    <Input
                                        value={newHardRule}
                                        onChange={(e) => setNewHardRule(e.target.value)}
                                        placeholder={t('hardRules.addPlaceholder')}
                                        className="border-indigo-100 focus:border-indigo-300"
                                        onKeyPress={(e) => {
                                            if (e.key === 'Enter' && newHardRule.trim()) {
                                                setTutorConfig({
                                                    ...tutorConfig,
                                                    hard_rules: [
                                                        ...tutorConfig.hard_rules,
                                                        newHardRule.trim(),
                                                    ],
                                                });
                                                setNewHardRule('');
                                            }
                                        }}
                                    />
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => {
                                            if (newHardRule.trim()) {
                                                setTutorConfig({
                                                    ...tutorConfig,
                                                    hard_rules: [
                                                        ...tutorConfig.hard_rules,
                                                        newHardRule.trim(),
                                                    ],
                                                });
                                                setNewHardRule('');
                                            }
                                        }}
                                        className="border-indigo-100 text-indigo-600 hover:bg-indigo-50"
                                    >
                                        <Plus className="mr-1 size-4" />
                                        {t('hardRules.add')}
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <div className="grid gap-6 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="adherenceLevel" className="text-sm font-medium">
                                    {t('adherence.label')}
                                </Label>
                                <Select
                                    value={tutorConfig.adherence_settings.level}
                                    onValueChange={(value: 'strict' | 'moderate' | 'flexible') =>
                                        setTutorConfig({
                                            ...tutorConfig,
                                            adherence_settings: {
                                                ...tutorConfig.adherence_settings,
                                                level: value,
                                            },
                                        })
                                    }
                                >
                                    <SelectTrigger
                                        id="adherenceLevel"
                                        className="border-indigo-100 focus:border-indigo-300"
                                    >
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="strict">
                                            {t('adherence.strict')}
                                        </SelectItem>
                                        <SelectItem value="moderate">
                                            {t('adherence.moderate')}
                                        </SelectItem>
                                        <SelectItem value="flexible">
                                            {t('adherence.flexible')}
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                                <p className="text-caption text-neutral-500">
                                    {t('adherence.helpText')}
                                </p>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="temperature" className="text-sm font-medium">
                                    {t('adherence.temperature', {
                                        value: tutorConfig.adherence_settings.temperature,
                                    })}
                                </Label>
                                <input
                                    id="temperature"
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.1"
                                    value={tutorConfig.adherence_settings.temperature}
                                    onChange={(e) =>
                                        setTutorConfig({
                                            ...tutorConfig,
                                            adherence_settings: {
                                                ...tutorConfig.adherence_settings,
                                                temperature: parseFloat(e.target.value),
                                            },
                                        })
                                    }
                                    className="w-full"
                                />
                                <p className="text-caption text-neutral-500">
                                    {t('adherence.temperatureHelp')}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Enabled Modes */}
                    <div className="space-y-3 border-t border-indigo-100 pt-4">
                        <Label className="text-sm font-medium">{t('modes.label')}</Label>
                        <p className="text-xs text-muted-foreground">{t('modes.helpText')}</p>
                        <div className="grid grid-cols-2 gap-2">
                            {[
                                {
                                    key: 'general',
                                    label: t('modes.general.label'),
                                    description: t('modes.general.description'),
                                },
                                {
                                    key: 'doubt',
                                    label: t('modes.doubt.label'),
                                    description: t('modes.doubt.description'),
                                },
                                {
                                    key: 'practice',
                                    label: t('modes.practice.label'),
                                    description: t('modes.practice.description'),
                                },
                                {
                                    key: 'voice_interview',
                                    label: t('modes.voiceInterview.label'),
                                    description: t('modes.voiceInterview.description'),
                                },
                                {
                                    key: 'voice_doubt',
                                    label: t('modes.voiceDoubt.label'),
                                    description: t('modes.voiceDoubt.description'),
                                },
                                {
                                    key: 'voice_oral_test',
                                    label: t('modes.voiceOralTest.label'),
                                    description: t('modes.voiceOralTest.description'),
                                },
                            ].map((mode) => (
                                <label
                                    key={mode.key}
                                    className="flex cursor-pointer items-start gap-2 rounded-lg border border-indigo-100 p-2 hover:border-indigo-200"
                                >
                                    <input
                                        type="checkbox"
                                        checked={
                                            tutorConfig.enabled_modes?.includes(mode.key) ?? false
                                        }
                                        onChange={(e) => {
                                            const current = tutorConfig.enabled_modes || [];
                                            setTutorConfig({
                                                ...tutorConfig,
                                                enabled_modes: e.target.checked
                                                    ? [...current, mode.key]
                                                    : current.filter((m) => m !== mode.key),
                                            });
                                        }}
                                        className="mt-0.5 rounded border-indigo-300"
                                    />
                                    <div>
                                        <span className="text-sm font-medium">{mode.label}</span>
                                        <p className="text-xs text-muted-foreground">
                                            {mode.description}
                                        </p>
                                    </div>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Voice Settings */}
                    {tutorConfig.enabled_modes?.some((m) => m.startsWith('voice_')) && (
                        <div className="space-y-3 border-t border-indigo-100 pt-4">
                            <Label className="text-sm font-medium">{t('voice.label')}</Label>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label className="text-xs text-muted-foreground">
                                        {t('voice.defaultLanguage')}
                                    </Label>
                                    <select
                                        value={
                                            tutorConfig.voice_settings?.default_language || 'en-IN'
                                        }
                                        onChange={(e) =>
                                            setTutorConfig({
                                                ...tutorConfig,
                                                voice_settings: {
                                                    ...tutorConfig.voice_settings!,
                                                    default_language: e.target.value,
                                                    default_voice:
                                                        tutorConfig.voice_settings?.default_voice ||
                                                        'shubh',
                                                },
                                            })
                                        }
                                        className="mt-1 w-full rounded-md border border-indigo-100 px-2 py-1.5 text-sm"
                                    >
                                        <option value="en-IN">{t('voice.languages.enIN')}</option>
                                        <option value="hi-IN">{t('voice.languages.hiIN')}</option>
                                        <option value="bn-IN">{t('voice.languages.bnIN')}</option>
                                        <option value="ta-IN">{t('voice.languages.taIN')}</option>
                                        <option value="te-IN">{t('voice.languages.teIN')}</option>
                                        <option value="kn-IN">{t('voice.languages.knIN')}</option>
                                        <option value="ml-IN">{t('voice.languages.mlIN')}</option>
                                        <option value="mr-IN">{t('voice.languages.mrIN')}</option>
                                        <option value="gu-IN">{t('voice.languages.guIN')}</option>
                                        <option value="pa-IN">{t('voice.languages.paIN')}</option>
                                        <option value="od-IN">{t('voice.languages.odIN')}</option>
                                    </select>
                                </div>
                                <div>
                                    <Label className="text-xs text-muted-foreground">
                                        {t('voice.defaultVoice')}
                                    </Label>
                                    <select
                                        value={tutorConfig.voice_settings?.default_voice || 'shubh'}
                                        onChange={(e) =>
                                            setTutorConfig({
                                                ...tutorConfig,
                                                voice_settings: {
                                                    ...tutorConfig.voice_settings!,
                                                    default_voice: e.target.value,
                                                    default_language:
                                                        tutorConfig.voice_settings
                                                            ?.default_language || 'en-IN',
                                                },
                                            })
                                        }
                                        className="mt-1 w-full rounded-md border border-indigo-100 px-2 py-1.5 text-sm"
                                    >
                                        <optgroup label={t('voice.male')}>
                                            <option value="shubh">{t('voice.voices.shubh')}</option>
                                            <option value="aditya">
                                                {t('voice.voices.aditya')}
                                            </option>
                                            <option value="rahul">{t('voice.voices.rahul')}</option>
                                            <option value="rohan">{t('voice.voices.rohan')}</option>
                                            <option value="amit">{t('voice.voices.amit')}</option>
                                            <option value="dev">{t('voice.voices.dev')}</option>
                                        </optgroup>
                                        <optgroup label={t('voice.female')}>
                                            <option value="ritu">{t('voice.voices.ritu')}</option>
                                            <option value="priya">{t('voice.voices.priya')}</option>
                                            <option value="neha">{t('voice.voices.neha')}</option>
                                            <option value="pooja">{t('voice.voices.pooja')}</option>
                                            <option value="simran">
                                                {t('voice.voices.simran')}
                                            </option>
                                            <option value="kavya">{t('voice.voices.kavya')}</option>
                                        </optgroup>
                                    </select>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Chatbot Page Visibility */}
                    <div className="space-y-3 border-t border-indigo-100 pt-4">
                        <Label className="text-sm font-medium">{t('pageVisibility.label')}</Label>
                        <p className="text-xs text-muted-foreground">
                            {t('pageVisibility.helpText')}
                        </p>
                        <div className="space-y-2">
                            {[
                                {
                                    key: 'dashboard',
                                    label: t('pageVisibility.dashboard.label'),
                                    description: t('pageVisibility.dashboard.description'),
                                    routes: ['/dashboard'],
                                },
                                {
                                    key: 'all_courses',
                                    label: t('pageVisibility.allCourses.label'),
                                    description: t('pageVisibility.allCourses.description'),
                                    routes: ['/study-library'],
                                },
                                {
                                    key: 'course_details',
                                    label: t('pageVisibility.courseDetails.label'),
                                    description: t('pageVisibility.courseDetails.description'),
                                    routes: ['/study-library/courses'],
                                },
                                {
                                    key: 'study_material',
                                    label: t('pageVisibility.studyMaterial.label'),
                                    description: t('pageVisibility.studyMaterial.description'),
                                    routes: ['/study-library/courses/course-details'],
                                },
                                {
                                    key: 'catalogue',
                                    label: t('pageVisibility.catalogue.label'),
                                    description: t('pageVisibility.catalogue.description'),
                                    routes: ['/catalogue', '/$tagName'],
                                },
                            ].map((category) => {
                                const isEnabled =
                                    tutorConfig.chatbot_pages?.includes(category.key) ?? false;
                                return (
                                    <label
                                        key={category.key}
                                        className="flex cursor-pointer items-start gap-3 rounded-lg border border-indigo-100 p-2.5 hover:border-indigo-200"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={isEnabled}
                                            onChange={(e) => {
                                                const current = tutorConfig.chatbot_pages || [];
                                                setTutorConfig({
                                                    ...tutorConfig,
                                                    chatbot_pages: e.target.checked
                                                        ? [...current, category.key]
                                                        : current.filter((k) => k !== category.key),
                                                });
                                            }}
                                            className="mt-0.5 rounded border-indigo-300"
                                        />
                                        <div>
                                            <span className="text-sm font-medium">
                                                {category.label}
                                            </span>
                                            <p className="text-xs text-muted-foreground">
                                                {category.description}
                                            </p>
                                        </div>
                                    </label>
                                );
                            })}
                        </div>
                    </div>

                    {/* Floating Launcher Behavior */}
                    <div className="space-y-3 border-t border-indigo-100 pt-4">
                        <Label className="text-sm font-medium">{t('launcher.label')}</Label>
                        <p className="text-xs text-muted-foreground">{t('launcher.helpText')}</p>

                        <div className="flex items-center justify-between gap-3 rounded-lg border border-indigo-100 p-2.5">
                            <div>
                                <span className="text-sm font-medium">
                                    {t('launcher.draggable.label')}
                                </span>
                                <p className="text-xs text-muted-foreground">
                                    {t('launcher.draggable.description')}
                                </p>
                            </div>
                            <Switch
                                checked={tutorConfig.launcher_settings?.draggable ?? true}
                                onCheckedChange={(v) =>
                                    setTutorConfig({
                                        ...tutorConfig,
                                        launcher_settings: {
                                            ...tutorConfig.launcher_settings,
                                            draggable: v,
                                        },
                                    })
                                }
                            />
                        </div>

                        <div className="flex items-center justify-between gap-3 rounded-lg border border-indigo-100 p-2.5">
                            <div>
                                <span className="text-sm font-medium">
                                    {t('launcher.nudge.label')}
                                </span>
                                <p className="text-xs text-muted-foreground">
                                    {t('launcher.nudge.description')}
                                </p>
                            </div>
                            <Switch
                                checked={tutorConfig.launcher_settings?.nudge_enabled ?? true}
                                onCheckedChange={(v) =>
                                    setTutorConfig({
                                        ...tutorConfig,
                                        launcher_settings: {
                                            ...tutorConfig.launcher_settings,
                                            nudge_enabled: v,
                                        },
                                    })
                                }
                            />
                        </div>

                        {(tutorConfig.launcher_settings?.nudge_enabled ?? true) && (
                            <div className="grid gap-6 md:grid-cols-2">
                                <div className="space-y-2">
                                    <Label className="text-sm font-medium">
                                        {t('launcher.showEvery')}
                                    </Label>
                                    <Input
                                        type="number"
                                        min={10}
                                        value={
                                            tutorConfig.launcher_settings?.nudge_interval_seconds ??
                                            120
                                        }
                                        onChange={(e) =>
                                            setTutorConfig({
                                                ...tutorConfig,
                                                launcher_settings: {
                                                    ...tutorConfig.launcher_settings,
                                                    nudge_interval_seconds: Number(e.target.value),
                                                },
                                            })
                                        }
                                        className="border-indigo-100 focus:border-indigo-300"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-sm font-medium">
                                        {t('launcher.stayOpenFor')}
                                    </Label>
                                    <Input
                                        type="number"
                                        min={1}
                                        value={
                                            tutorConfig.launcher_settings?.nudge_duration_seconds ??
                                            5
                                        }
                                        onChange={(e) =>
                                            setTutorConfig({
                                                ...tutorConfig,
                                                launcher_settings: {
                                                    ...tutorConfig.launcher_settings,
                                                    nudge_duration_seconds: Number(e.target.value),
                                                },
                                            })
                                        }
                                        className="border-indigo-100 focus:border-indigo-300"
                                    />
                                </div>
                            </div>
                        )}

                        <div className="flex items-center justify-between gap-3 rounded-lg border border-indigo-100 p-2.5">
                            <div>
                                <span className="text-sm font-medium">
                                    {t('launcher.bounce.label')}
                                </span>
                                <p className="text-xs text-muted-foreground">
                                    {t('launcher.bounce.description')}
                                </p>
                            </div>
                            <Switch
                                checked={tutorConfig.launcher_settings?.bounce ?? true}
                                onCheckedChange={(v) =>
                                    setTutorConfig({
                                        ...tutorConfig,
                                        launcher_settings: {
                                            ...tutorConfig.launcher_settings,
                                            bounce: v,
                                        },
                                    })
                                }
                            />
                        </div>
                    </div>

                    {/* Chatbot header */}
                    <div className="space-y-3 border-t border-indigo-100 pt-4">
                        <Label className="text-sm font-medium">{t('header.label')}</Label>
                        <p className="text-xs text-muted-foreground">{t('header.helpText')}</p>

                        <div className="flex items-center justify-between gap-3 rounded-lg border border-indigo-100 p-2.5">
                            <div>
                                <span className="text-sm font-medium">
                                    {t('header.aiSettingsShortcut.label')}
                                </span>
                                <p className="text-xs text-muted-foreground">
                                    {t('header.aiSettingsShortcut.description')}
                                </p>
                            </div>
                            <Switch
                                checked={tutorConfig.show_ai_settings_shortcut ?? false}
                                onCheckedChange={(v) =>
                                    setTutorConfig({
                                        ...tutorConfig,
                                        show_ai_settings_shortcut: v,
                                    })
                                }
                            />
                        </div>
                    </div>

                    <div className="flex justify-end pt-4">
                        <MyButton
                            disabled={isSavingTutor}
                            onClick={handleSaveTutorConfig}
                            className="min-w-32 bg-indigo-600 text-white hover:bg-indigo-700"
                        >
                            {isSavingTutor ? (
                                <>
                                    <span className="mr-2 size-4 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
                                    {t('actions.saving')}
                                </>
                            ) : (
                                <>
                                    <FloppyDisk className="mr-2 size-4" />
                                    {t('actions.save')}
                                </>
                            )}
                        </MyButton>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default StudentAiSettingsSection;
