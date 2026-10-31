import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ChalkboardTeacher, CircleNotch, FloppyDisk, Waveform } from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { MyButton } from '@/components/design-system/button';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getInstituteId } from '@/constants/helper';
import { GET_INSTITUTE_SETTING_DATA } from '@/constants/urls';
import { saveInstituteSettingKey } from '@/services/package-settings';
import {
    TUTOR_MODE_SETTING_KEY,
    TUTOR_TTS_PROVIDERS,
    TUTOR_VOICE_PACES,
    cloneTutorVoice,
    getTutorOptions,
    type TutorModeSetting,
    type TutorOptions,
} from '@/services/tutor';
import { TeacherPresenceField } from '@/components/common/tutor/TeacherPresenceField';
import { ModelPicker, VoicePicker } from '@/components/common/tutor/TutorPickers';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

const DEFAULTS: TutorModeSetting = {
    enabled: true,
    defaultOn: true,
    teacherName: 'Asha',
    // Sarvam is what the runtime speaks with today; Smallest.ai arrives with
    // the browser TTS path (WP7) and is listed as coming soon until then.
    ttsProvider: 'sarvam',
    ttsVoice: '',
    languages: ['en', 'hi'],
    sessionLanguage: 'course',
    llmModel: '',
    compileModel: '',
    strictness: 'normal',
    generateImages: true,
    voicePace: 1,
    teacherAvatarFileId: '',
};

/**
 * Institute-wide defaults for the Live AI Tutor (institute setting key
 * TUTOR_MODE_SETTING, design §5.3). Every course inherits these; the course's
 * own Tutor Mode tab overrides field by field.
 */
export const TutorModeDefaultsCard: React.FC = () => {
    const courseLower = getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase();
    const coursesTerm = getTerminologyPlural(ContentTerms.Course, SystemTerms.Course);
    const [value, setValue] = useState<TutorModeSetting>(DEFAULTS);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [cloning, setCloning] = useState(false);
    const [cloneName, setCloneName] = useState('');
    const [options, setOptions] = useState<TutorOptions | null>(null);
    useEffect(() => {
        getTutorOptions()
            .then(setOptions)
            .catch(() => setOptions(null));
    }, []);
    const fileRef = useRef<HTMLInputElement>(null);

    const cloneVoice = async () => {
        const file = fileRef.current?.files?.[0];
        if (!file) {
            toast.error('Choose a 5–15 second recording of the teacher first');
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            toast.error('The sample must be under 5 MB');
            return;
        }
        setCloning(true);
        try {
            const res = await cloneTutorVoice(
                file,
                cloneName.trim() || value.teacherName || 'Teacher'
            );
            setValue((s) => ({ ...s, ttsProvider: 'smallest', ttsVoice: res.voice_id }));
            setDirty(true);
            toast.success('Voice cloned. Save defaults to start using it.');
        } catch (e: unknown) {
            const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data
                ?.detail;
            toast.error(detail || (e instanceof Error ? e.message : 'Could not clone the voice'));
        } finally {
            setCloning(false);
        }
    };

    useEffect(() => {
        let cancelled = false;
        const instituteId = getInstituteId();
        authenticatedAxiosInstance
            .get<{ data?: TutorModeSetting } | TutorModeSetting | null>(
                GET_INSTITUTE_SETTING_DATA,
                {
                    params: { instituteId, settingKey: TUTOR_MODE_SETTING_KEY },
                }
            )
            .then((res) => {
                if (cancelled) return;
                // saveInstituteSettingKey stores { data: {...} }; tolerate both shapes.
                const raw = res.data;
                const data =
                    raw && typeof raw === 'object' && 'data' in raw
                        ? (raw as { data?: TutorModeSetting }).data
                        : (raw as TutorModeSetting | null);
                if (data && typeof data === 'object') setValue({ ...DEFAULTS, ...data });
            })
            .catch(() => {
                /* absent key: defaults */
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const update = <K extends keyof TutorModeSetting>(key: K, v: TutorModeSetting[K]) => {
        setValue((s) => ({ ...s, [key]: v }));
        setDirty(true);
    };

    const save = async () => {
        setSaving(true);
        try {
            await saveInstituteSettingKey(
                TUTOR_MODE_SETTING_KEY,
                value as Record<string, unknown>,
                'Tutor Mode'
            );
            setDirty(false);
            toast.success('Tutor mode defaults saved');
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : 'Could not save');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                    <ChalkboardTeacher className="size-5 text-primary-500" />
                    Tutor Mode defaults
                    {loading && <CircleNotch className="size-4 animate-spin text-neutral-400" />}
                </CardTitle>
                <p className="text-sm text-neutral-500">
                    Institute-wide defaults for the one-to-one AI teacher. Each {courseLower} can
                    override any of these from its Tutor Mode tab.
                </p>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-6">
                    <label className="flex items-center gap-2 text-sm">
                        <Switch
                            checked={!!value.enabled}
                            onCheckedChange={(v) => update('enabled', v)}
                        />
                        Tutor mode available to {coursesTerm.toLocaleLowerCase()}
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                        <Switch
                            checked={!!value.defaultOn}
                            onCheckedChange={(v) => update('defaultOn', v)}
                        />
                        Start learners in teaching mode by default
                    </label>
                    <label
                        className="flex items-center gap-2 text-sm"
                        title={`AI-generated pictures on whiteboards where a photo teaches better than a diagram. About 1 credit each, at most 4 per slide. ${coursesTerm} created by the copilot follow this default.`}
                    >
                        <Switch
                            checked={value.generateImages !== false}
                            onCheckedChange={(v) => update('generateImages', v)}
                        />
                        AI images on boards
                    </label>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="space-y-1">
                        <Label>Teacher name</Label>
                        <Input
                            value={value.teacherName ?? ''}
                            maxLength={60}
                            onChange={(e) => update('teacherName', e.target.value)}
                        />
                    </div>
                    <div className="space-y-1">
                        <Label>Voice provider</Label>
                        <Select
                            value={value.ttsProvider ?? 'sarvam'}
                            onValueChange={(v) =>
                                update('ttsProvider', v as TutorModeSetting['ttsProvider'])
                            }
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {TUTOR_TTS_PROVIDERS.map((p) => (
                                    <SelectItem key={p.value} value={p.value}>
                                        {p.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
                        <Label>Voice</Label>
                        <VoicePicker
                            value={value.ttsVoice || undefined}
                            onChange={(v) => update('ttsVoice', v ?? '')}
                            provider={value.ttsProvider ?? 'sarvam'}
                            voices={options?.voices?.[value.ttsProvider ?? 'sarvam'] ?? []}
                            inheritLabel="Provider default (female)"
                        />
                    </div>
                    <div className="space-y-1">
                        <Label>Session language</Label>
                        <Select
                            value={value.sessionLanguage ?? 'course'}
                            onValueChange={(v) =>
                                update('sessionLanguage', v as 'course' | 'learner')
                            }
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="course">
                                    Course language (learner may switch)
                                </SelectItem>
                                <SelectItem value="learner">Learner&apos;s preference</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
                        <Label>Voice pace</Label>
                        <Select
                            value={String(
                                typeof value.voicePace === 'number' ? value.voicePace : 1
                            )}
                            onValueChange={(v) => update('voicePace', Number(v))}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {TUTOR_VOICE_PACES.map((p) => (
                                    <SelectItem key={p.value} value={String(p.value)}>
                                        {p.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
                        <Label>Live model (LLM)</Label>
                        <ModelPicker
                            value={value.llmModel || undefined}
                            onChange={(v) => update('llmModel', v ?? '')}
                            models={options?.models ?? []}
                            inheritLabel="Platform default"
                        />
                    </div>
                    <div className="space-y-1">
                        <Label>Compile model</Label>
                        <ModelPicker
                            value={value.compileModel || undefined}
                            onChange={(v) => update('compileModel', v ?? '')}
                            models={options?.models ?? []}
                            inheritLabel="Platform default"
                        />
                    </div>
                    <div className="space-y-1">
                        <Label>Strictness</Label>
                        <Select
                            value={value.strictness ?? 'normal'}
                            onValueChange={(v) =>
                                update('strictness', v as TutorModeSetting['strictness'])
                            }
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="gentle">Gentle</SelectItem>
                                <SelectItem value="normal">Normal</SelectItem>
                                <SelectItem value="strict">Strict</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <TeacherPresenceField
                    fileId={value.teacherAvatarFileId || undefined}
                    teacherName={value.teacherName}
                    provider={value.avatarProvider ?? 'none'}
                    avatarId={value.avatarId}
                    options={options}
                    onFaceChange={(id) => update('teacherAvatarFileId', id ?? '')}
                    onAvatarChange={(provider, avatarId) => {
                        update('avatarProvider', provider ?? 'none');
                        update('avatarId', avatarId);
                    }}
                />
                <div className="space-y-2 rounded-md border border-neutral-200 bg-neutral-50 p-3">
                    <p className="flex items-center gap-2 text-sm font-medium text-neutral-800">
                        <Waveform className="size-4 text-primary-500" />
                        Clone your teacher&apos;s voice (Smallest.ai)
                    </p>
                    <p className="text-xs text-neutral-600">
                        Upload a clean 5–15 second recording of the teacher speaking (mp3, wav, mp4
                        or webm, under 5 MB). Only upload a voice you have the person&apos;s
                        permission to use. The cloned voice is private to this institute and becomes
                        the tutor voice for every {courseLower} that inherits these defaults.
                        {options?.fees?.voice
                            ? ` Charged once: ${options.fees.voice} credits per voice.`
                            : ''}
                    </p>
                    <div className="flex flex-wrap items-end gap-2">
                        <div className="space-y-1">
                            <Label>Voice name</Label>
                            <Input
                                value={cloneName}
                                maxLength={80}
                                placeholder={value.teacherName || 'Teacher'}
                                onChange={(e) => setCloneName(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1">
                            <Label>Sample</Label>
                            <Input
                                ref={fileRef}
                                type="file"
                                accept=".mp3,.wav,.mp4,.webm,audio/*"
                            />
                        </div>
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            layoutVariant="default"
                            disable={cloning}
                            onClick={() => void cloneVoice()}
                        >
                            {cloning ? (
                                <CircleNotch className="size-4 animate-spin" />
                            ) : (
                                <Waveform className="size-4" />
                            )}
                            Clone voice
                        </MyButton>
                    </div>
                </div>
                <div className="flex justify-end">
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        layoutVariant="default"
                        disable={!dirty || saving}
                        onClick={() => void save()}
                    >
                        {saving ? (
                            <CircleNotch className="size-4 animate-spin" />
                        ) : (
                            <FloppyDisk className="size-4" />
                        )}
                        Save defaults
                    </MyButton>
                </div>
            </CardContent>
        </Card>
    );
};
